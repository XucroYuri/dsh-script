import { existsSync } from 'node:fs'
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { runNpm } from '../scripts/npm-cli.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const bundle = resolve(here, '..')
const workspace = resolve(bundle, '../..')
const installSpec = process.env.NOVEL_STUDIO_INSTALL_SPEC ? resolve(process.env.NOVEL_STUDIO_INSTALL_SPEC) : bundle
const require = createRequire(import.meta.url)

function resolveDshBin() {
  const candidates = []
  if (process.env.NOVEL_STUDIO_DSH_BIN) candidates.push(resolve(process.env.NOVEL_STUDIO_DSH_BIN))
  try { candidates.push(join(dirname(require.resolve('@deepseek-ai/dsh/package.json')), 'lib', 'bin.js')) } catch {}
  const npmArgs = ['root', '--global']
  const npmRoot = runNpm(npmArgs, { encoding: 'utf8' })
  if (npmRoot.status === 0 && npmRoot.stdout.trim()) candidates.push(join(npmRoot.stdout.trim(), '@deepseek-ai', 'dsh', 'lib', 'bin.js'))
  // Contributors commonly keep the Harness and plugin repositories beside one
  // another. This fallback remains relative to the checkout and never bakes a
  // developer-specific absolute path into the package or CI configuration.
  candidates.push(resolve(workspace, '../deepseek-harness/apps/cli/lib/bin.js'))
  const found = candidates.find(candidate => existsSync(candidate))
  if (found) return found
  throw new Error('DeepSeek Harness CLI not found. Install @deepseek-ai/dsh@0.1.0-rc.7 globally or set NOVEL_STUDIO_DSH_BIN.')
}

const dshBin = resolveDshBin()
const temporaryRoot = process.env.NOVEL_STUDIO_TEST_TMP ? resolve(process.env.NOVEL_STUDIO_TEST_TMP) : tmpdir()
await mkdir(temporaryRoot, { recursive: true })
await access(dshBin)
const isolatedHome = await mkdtemp(join(temporaryRoot, 'novel-studio-dsh-'))
const profileDir = join(isolatedHome, 'profiles', 'web')
const env = { ...process.env, DSH_HOME: isolatedHome, DSH_TELEMETRY_MODE: 'DISABLED', NOVEL_STUDIO_COMPOSITION_MODEL: '1' }

function run(args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [dshBin, ...args], {
      cwd: workspace,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      ...options,
    })
    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', chunk => { stdout += chunk })
    child.stderr?.on('data', chunk => { stderr += chunk })
    child.once('error', reject)
    child.once('exit', code => {
      if (code === 0) resolvePromise({ stdout, stderr })
      else reject(new Error(`dsh ${args.join(' ')} failed (${code})\n${stdout}\n${stderr}`))
    })
  })
}

async function waitForUrl(child) {
  return new Promise((resolvePromise, reject) => {
    let output = ''
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for dsh web URL\n${output}`)), 30_000)
    const inspect = chunk => {
      output += chunk.toString()
      const match = output.match(/dsh web:\s+(http:\/\/127\.0\.0\.1:\d+)/)
      if (match) {
        clearTimeout(timer)
        resolvePromise(match[1])
      }
    }
    child.stdout.on('data', inspect)
    child.stderr.on('data', inspect)
    child.once('exit', code => {
      clearTimeout(timer)
      reject(new Error(`dsh web exited before startup (${code})\n${output}`))
    })
  })
}

let server
let url

async function startServer() {
  const child = spawn(process.execPath, [dshBin, '--profile', 'web', '--port', '0'], {
    cwd: workspace,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stderr.on('data', chunk => { process.stderr.write(chunk) })
  return { child, url: await waitForUrl(child) }
}

async function stopServer(child) {
  if (child && child.exitCode === null) {
    child.kill('SIGTERM')
    await new Promise(resolvePromise => child.once('exit', resolvePromise))
  }
}

async function json(path, init) {
  let response
  try {
    response = await fetch(`${url}${path}`, {
      ...init,
      headers: { accept: 'application/json', ...(init?.body ? { 'content-type': 'application/json' } : {}) },
    })
  } catch (cause) {
    throw new Error(`${path} transport failed: ${cause instanceof Error ? cause.message : String(cause)}`, { cause })
  }
  const body = await response.json()
  if (!response.ok) throw new Error(`${path} failed (${response.status}): ${JSON.stringify(body)}`)
  return body
}

async function waitForWorkflow(workflowRunId, status, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const run = await json(`/api/novel-studio/v1/workflows/${workflowRunId}`)
    if (run.status === status) return run
    await new Promise(resolvePromise => setTimeout(resolvePromise, 100))
  }
  throw new Error(`Timed out waiting for workflow ${workflowRunId} to become ${status}`)
}

async function waitForFoundationRun(runId, status, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const run = await json(`/api/novel-studio/v1/foundation-runs/${runId}`)
    if (run.status === status) return run
    if (run.status === 'failed') throw new Error(`Foundation generation ${runId} failed: ${JSON.stringify(run)}`)
    await new Promise(resolvePromise => setTimeout(resolvePromise, 100))
  }
  throw new Error(`Timed out waiting for foundation generation ${runId} to become ${status}`)
}

async function waitForFoundationPreview(runId, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const run = await json(`/api/novel-studio/v1/foundation-runs/${runId}`)
    if (run.status === 'generating' && run.streamedText?.length > 0) return run
    if (run.status === 'failed') throw new Error(`Foundation generation ${runId} failed before live preview: ${JSON.stringify(run)}`)
    await new Promise(resolvePromise => setTimeout(resolvePromise, 25))
  }
  throw new Error(`Timed out waiting for foundation live preview ${runId}`)
}

async function waitForChapterPreview(chapterId, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const runs = await json(`/api/novel-studio/v1/chapters/${chapterId}/model-runs`)
    const run = runs.find(item => item.purpose === 'chapter-draft' && item.status === 'running' && item.streamedText?.length > 0)
    if (run) return run
    await new Promise(resolvePromise => setTimeout(resolvePromise, 25))
  }
  throw new Error(`Timed out waiting for chapter live preview ${chapterId}`)
}

async function buildFoundation(projectId, verifyPostDraftRevision = false) {
  const foundationKinds = ['outline','characters','timeline']
  for (const kind of foundationKinds) {
    const started = await json(`/api/novel-studio/v1/projects/${projectId}/foundation/${kind}/runs`, { method: 'POST', body: JSON.stringify({ brief: '', guided: false }) })
    if (started.guided !== false || started.brief !== '' || started.questions.length !== 0) throw new Error(`Draft-first ${kind} did not start without user input: ${JSON.stringify(started)}`)
    const livePreview = await waitForFoundationPreview(started.id)
    if (!livePreview.streamedText || livePreview.resultVersionId !== null) throw new Error(`Foundation live preview was not a pre-version state: ${JSON.stringify(livePreview)}`)
    if (!(livePreview.generationTelemetry?.estimatedTokensPerSecond > 0)) throw new Error(`Foundation live generation pulse was not persisted: ${JSON.stringify(livePreview.generationTelemetry)}`)
    const completed = await waitForFoundationRun(started.id, 'succeeded')
    if (completed.progress !== 100 || completed.streamedCharacters <= 0 || completed.streamedText.length <= 0) throw new Error(`Foundation progress was not persisted: ${JSON.stringify(completed)}`)
    if (!(completed.generationTelemetry?.finalTokensPerSecond > 0) || !(completed.generationTelemetry?.finalOutputTokens > 0)) throw new Error(`Foundation final generation pulse did not use official usage: ${JSON.stringify(completed.generationTelemetry)}`)
    let generatedFoundation = await json(`/api/novel-studio/v1/projects/${projectId}/foundation`)
    let stage = generatedFoundation.stages.find(item => item.kind === kind)
    if (!stage?.latestVersion || stage.status !== 'draft') throw new Error(`Foundation ${kind} did not create a draft: ${JSON.stringify(stage)}`)
    if (completed.streamedText !== stage.latestVersion.content) throw new Error(`Foundation live preview did not converge to the immutable draft: ${JSON.stringify(completed)}`)
    if (stage.latestVersion.generationRunId !== started.id) throw new Error(`Foundation ${kind} was not linked to its generation run`)

    if (kind === 'outline' && verifyPostDraftRevision) {
      const initialVersionId = stage.latestVersion.id
      const revision = await json(`/api/novel-studio/v1/projects/${projectId}/foundation/outline/runs`, { method: 'POST', body: JSON.stringify({ brief: '', guided: true }) })
      if (revision.interactionSessionId !== null) throw new Error(`Studio-started revision unexpectedly bound a Harness conversation: ${JSON.stringify(revision)}`)
      const waiting = await waitForFoundationRun(revision.id, 'waiting_input')
      if (waiting.planningRound !== 1 || waiting.informationReady !== false || waiting.questions.length < 1 || waiting.questions[0].options.length < 2) throw new Error(`Post-draft revision did not produce the first inline question round: ${JSON.stringify(waiting)}`)
      const visibleDuringWait = await json(`/api/novel-studio/v1/projects/${projectId}/foundation`)
      if (visibleDuringWait.stages.find(item => item.kind === kind)?.activeGenerationRun?.id !== waiting.id) throw new Error('Waiting revision was not recoverable through the foundation workspace')
      await json(`/api/novel-studio/v1/foundation-runs/${waiting.id}/answers`, { method: 'POST', body: JSON.stringify({ answers: waiting.questions.map(question => ({ questionId: question.id, optionId: question.options[0].id, customText: 'Composition confirmed direction.' })) }) })
      const secondWaiting = await waitForFoundationRun(revision.id, 'waiting_input')
      if (secondWaiting.planningRound !== 2 || secondWaiting.answers.length !== 1 || secondWaiting.questions.length !== 2 || !secondWaiting.readinessSummary.includes('最终代价')) throw new Error(`Revision planner did not continue to the second inline round: ${JSON.stringify(secondWaiting)}`)
      const currentQuestions = secondWaiting.questions.filter(question => !secondWaiting.answers.some(answer => answer.questionId === question.id))
      await json(`/api/novel-studio/v1/foundation-runs/${secondWaiting.id}/answers`, { method: 'POST', body: JSON.stringify({ answers: currentQuestions.map(question => ({ questionId: question.id, optionId: question.options[0].id, customText: 'Composition final cost confirmed.' })) }) })
      const revisionLive = await waitForFoundationPreview(revision.id)
      if (!(revisionLive.generationTelemetry?.estimatedTokensPerSecond > 0)) throw new Error(`Revision live generation pulse was not persisted: ${JSON.stringify(revisionLive.generationTelemetry)}`)
      const revisionCompleted = await waitForFoundationRun(revision.id, 'succeeded')
      if (!(revisionCompleted.generationTelemetry?.finalTokensPerSecond > 0) || !(revisionCompleted.generationTelemetry?.finalOutputTokens > 0)) throw new Error(`Revision final pulse did not use official usage: ${JSON.stringify(revisionCompleted.generationTelemetry)}`)
      generatedFoundation = await json(`/api/novel-studio/v1/projects/${projectId}/foundation`)
      stage = generatedFoundation.stages.find(item => item.kind === kind)
      if (!stage?.latestVersion || stage.latestVersion.id === initialVersionId || stage.latestVersion.version !== 2) throw new Error(`Post-draft revision did not create a second immutable version: ${JSON.stringify(stage)}`)
      if (!stage.latestVersion.content.includes('人物变化') || !stage.latestVersion.content.includes('不可逆代价')) throw new Error(`Revision answers did not reach formal generation: ${stage.latestVersion.content}`)
    }

    const approvedFoundation = await json(`/api/novel-studio/v1/projects/${projectId}/foundation/${kind}/approve`, { method: 'POST', body: JSON.stringify({ versionId: stage.latestVersion.id }) })
    if (approvedFoundation.stages.find(item => item.kind === kind)?.status !== 'approved') throw new Error(`Foundation ${kind} was not approved`)
  }
  const foundationReady = await json(`/api/novel-studio/v1/projects/${projectId}/foundation`)
  if (!foundationReady.readyForChapterGeneration || foundationReady.approvedVersionIds.length !== 3 || !foundationReady.assemblyHash) throw new Error(`Project foundation is incomplete: ${JSON.stringify(foundationReady)}`)
  return foundationReady
}

try {
  await run(['plugin', '--profile', 'web', 'add', installSpec])
  const profile = JSON.parse(await readFile(join(profileDir, 'package.json'), 'utf8'))
  if (!profile.dsh.profile.bundles.includes('@novel-studio/dsh-novel-studio')) {
    throw new Error('Bundle was installed but not activated in the profile manifest')
  }

  const dump = await run(['--profile', 'web', '--dump-config'])
  if (!dump.stdout.includes("name: '@novel-studio/dsh-novel-studio'")) {
    throw new Error(`Composed config does not contain Novel Studio\n${dump.stdout}`)
  }

  ;({ child: server, url } = await startServer())
  const doctor = await fetch(`${url}/api/novel-studio/doctor`).then(async response => ({ status: response.status, body: await response.json() }))
  if (doctor.status !== 200 || doctor.body.ok !== true || doctor.body.capabilities.novelDoctorTool !== true) {
    throw new Error(`Doctor endpoint failed: ${JSON.stringify(doctor)}`)
  }
  if (doctor.body.phase !== 5 || doctor.body.capabilities.database !== true || doctor.body.capabilities.workflows !== true || doctor.body.capabilities.knowledgeTools !== true || doctor.body.capabilities.recovery !== true || doctor.body.capabilities.longNovelMemory !== true || doctor.body.capabilities.harnessCompaction?.available !== false || doctor.body.storage.schemaVersion !== 20 || doctor.body.storage.journalMode !== 'wal') {
    throw new Error(`Phase 5 storage and recovery are not healthy: ${JSON.stringify(doctor.body)}`)
  }
  if (doctor.body.model.ready !== true || doctor.body.model.selection.provider !== 'novel-studio-test') throw new Error(`Composition model is not ready: ${JSON.stringify(doctor.body.model)}`)
  const doctorTool = await fetch(`${url}/api/novel-studio/doctor/tool-smoke`).then(async response => ({
    status: response.status,
    body: await response.json(),
  }))
  if (doctorTool.status !== 200 || doctorTool.body.ok !== true || doctorTool.body.service !== 'novel-studio') {
    throw new Error(`novel_doctor execution failed: ${JSON.stringify(doctorTool)}`)
  }

  const html = await fetch(url).then(response => response.text())
  if (!html.includes('@novel-studio/dsh-novel-studio')) {
    throw new Error('Web boot manifest does not include the Novel Studio Client module')
  }

  const created = await json('/api/novel-studio/v1/projects', { method: 'POST', body: JSON.stringify({ title: 'Composition Smoke Novel', genre: 'test' }) })
  const projectId = created.project.id
  await buildFoundation(projectId, true)
  const chapter = await json(`/api/novel-studio/v1/projects/${projectId}/chapters`, { method: 'POST', body: JSON.stringify({ title: 'Chapter One' }) })
  const emptyGrowth = await json(`/api/novel-studio/v1/projects/${projectId}/growth`)
  if (emptyGrowth.anchors.length !== 1 || emptyGrowth.anchors[0].branches.length !== 0) throw new Error(`Story growth map did not project the empty chapter: ${JSON.stringify(emptyGrowth)}`)
  const emptyStatistics = await json(`/api/novel-studio/v1/projects/${projectId}/statistics`)
  if (emptyStatistics.totals.runs !== 0 || emptyStatistics.totals.generatedWords !== 0 || emptyStatistics.chapters.length !== 1) throw new Error(`Project statistics did not project the empty chapter: ${JSON.stringify(emptyStatistics)}`)
  const first = await json(`/api/novel-studio/v1/chapters/${chapter.id}/drafts`, { method: 'POST', body: JSON.stringify({ content: 'First immutable version.', baseRevision: chapter.revision, origin: 'user' }) })
  const second = await json(`/api/novel-studio/v1/chapters/${chapter.id}/drafts`, { method: 'POST', body: JSON.stringify({ content: 'Second immutable version survives restart.', baseRevision: first.revision, origin: 'autosave' }) })
  if (second.versions.length !== 2) throw new Error(`Expected two immutable versions: ${JSON.stringify(second)}`)
  const approved = await json(`/api/novel-studio/v1/chapters/${chapter.id}/approve`, { method: 'POST', body: JSON.stringify({ versionId: second.currentDraftVersionId, baseRevision: second.revision }) })
  if (approved.currentApprovedVersionId !== second.currentDraftVersionId) throw new Error('Approval did not move the approved pointer')
  const rewrite = await json(`/api/novel-studio/v1/chapters/${chapter.id}/rewrite-selection`, { method: 'POST', body: JSON.stringify({ selectedText: 'immutable version', contextBefore: 'Second ', contextAfter: ' survives restart.', instruction: 'Make it shorter', baseRevision: approved.revision }) })
  if (rewrite.replacementText !== 'Short replacement.') throw new Error(`Selection rewrite did not apply the user's instruction to an isolated replacement: ${JSON.stringify(rewrite)}`)
  const afterRewrite = await json(`/api/novel-studio/v1/chapters/${chapter.id}`)
  if (afterRewrite.revision !== approved.revision || afterRewrite.versions.length !== approved.versions.length) throw new Error(`Selection rewrite mutated the chapter before the client applied it: ${JSON.stringify(afterRewrite)}`)

  const grown = await json(`/api/novel-studio/v1/projects/${projectId}/growth`)
  if (grown.anchors[0].branches.length !== 2 || grown.totalWordCount <= 0) throw new Error(`Story growth map did not project immutable versions: ${JSON.stringify(grown)}`)
  if (JSON.stringify(grown).includes('Second immutable version survives restart.')) throw new Error('Story growth map leaked manuscript text')

  const promptCatalog = await json(`/api/novel-studio/v1/prompts/${projectId}`)
  const originalScenePrompt = promptCatalog.selections['scene-plan']
  const sceneAsset = promptCatalog.assets.find(asset => asset.purpose === 'scene-plan')
  const customPrompt = await json(`/api/novel-studio/v1/prompts/${sceneAsset.id}/versions`, { method: 'POST', body: JSON.stringify({ template: `${sceneAsset.versions[0].template}\nComposition custom rule.` }) })
  await json(`/api/novel-studio/v1/projects/${projectId}/prompts/select`, { method: 'POST', body: JSON.stringify({ purpose: 'scene-plan', promptAssetVersionId: customPrompt.id }) })
  const emptyGenerationSources = await json(`/api/novel-studio/v1/chapters/${chapter.id}/generation-sources`)
  if (emptyGenerationSources.status !== 'unavailable' || emptyGenerationSources.items.length !== 0) throw new Error(`Generation source panel exposed a fabricated pre-run list: ${JSON.stringify(emptyGenerationSources)}`)
  const scenePlan = await json(`/api/novel-studio/v1/chapters/${chapter.id}/generate`, { method: 'POST', body: JSON.stringify({ purpose: 'scene-plan' }) })
  if (scenePlan.modelRun.status !== 'succeeded' || scenePlan.modelRun.promptAssetVersionId !== customPrompt.id) throw new Error(`Scene plan trace failed: ${JSON.stringify(scenePlan)}`)
  const draftPromise = json(`/api/novel-studio/v1/chapters/${chapter.id}/generate`, { method: 'POST', body: JSON.stringify({ purpose: 'chapter-draft' }) }).then(value => ({ value }), error => ({ error }))
  const liveChapterDraft = await waitForChapterPreview(chapter.id)
  if (!liveChapterDraft.streamedText || liveChapterDraft.streamedText.startsWith('{')) throw new Error(`Chapter live preview did not expose manuscript text: ${JSON.stringify(liveChapterDraft)}`)
  if (!(liveChapterDraft.generationTelemetry?.estimatedTokensPerSecond > 0)) throw new Error(`Chapter live generation pulse was not persisted: ${JSON.stringify(liveChapterDraft.generationTelemetry)}`)
  const draftResult = await draftPromise
  if (draftResult.error) throw draftResult.error
  const draft = draftResult.value
  const generatedVersion = draft.chapter.versions.find(version => version.modelRunId === draft.modelRun.id)
  if (!generatedVersion || generatedVersion.origin !== 'model' || generatedVersion.promptAssetVersionId !== draft.modelRun.promptAssetVersionId) throw new Error(`Generated manuscript trace failed: ${JSON.stringify(draft)}`)
  if (!(draft.modelRun.generationTelemetry?.finalTokensPerSecond > 0) || !(draft.modelRun.generationTelemetry?.finalOutputTokens > 0)) throw new Error(`Chapter final generation pulse did not converge to official usage: ${JSON.stringify(draft.modelRun.generationTelemetry)}`)
  const generationStatistics = await json(`/api/novel-studio/v1/projects/${projectId}/statistics`)
  if (generationStatistics.totals.runs !== 2 || generationStatistics.totals.succeededRuns !== 2 || generationStatistics.totals.usageReportedRuns !== 2 || generationStatistics.totals.inputTokens <= 0 || generationStatistics.totals.outputTokens <= 0 || generationStatistics.totals.generatedWords !== generatedVersion.wordCount) throw new Error(`Project generation statistics are inaccurate: ${JSON.stringify(generationStatistics)}`)
  if (JSON.stringify(generationStatistics).includes('Second immutable version survives restart.') || JSON.stringify(generationStatistics).includes(generatedVersion.content)) throw new Error('Project generation statistics leaked manuscript text')
  const generationSources = await json(`/api/novel-studio/v1/chapters/${chapter.id}/generation-sources`)
  if (generationSources.status !== 'succeeded' || !generationSources.items.some(item => item.kind === 'foundation') || !generationSources.items.some(item => item.kind === 'style')) throw new Error(`Generation source trace did not expose the frozen foundation and style: ${JSON.stringify(generationSources)}`)
  const updatedScenePrompt = await json(`/api/novel-studio/v1/prompts/${sceneAsset.id}/versions`, { method: 'POST', body: JSON.stringify({ template: `${sceneAsset.versions[0].template}\nA later version.` }) })
  if (updatedScenePrompt.id === customPrompt.id) throw new Error('Prompt version did not advance')
  const tracedRuns = await json(`/api/novel-studio/v1/chapters/${chapter.id}/model-runs`)
  const originalRun = tracedRuns.find(run => run.id === scenePlan.modelRun.id)
  if (originalRun.promptAssetVersionId !== customPrompt.id || originalRun.promptAssetVersionId === originalScenePrompt) throw new Error('Old generation trace changed after Prompt update')
  const promptTrace = JSON.parse(originalRun.inputSnapshotJson).promptAssemblyTrace
  if (!promptTrace || promptTrace.contextWindowSource !== 'fallback' || !promptTrace.sections.some(section => section.key === 'foundation' && section.included)) throw new Error(`Long-novel prompt assembly trace is incomplete: ${originalRun.inputSnapshotJson}`)

  const interruptedWorkflow = await json(`/api/novel-studio/v1/chapters/${chapter.id}/workflows`, { method: 'POST', body: JSON.stringify({ stopAfterNode: 'validate_scene_plan' }) })
  if (interruptedWorkflow.status !== 'running' || interruptedWorkflow.currentNodeKey !== 'generate_draft') throw new Error(`Workflow did not stop at the durable boundary: ${JSON.stringify(interruptedWorkflow)}`)
  const successfulBeforeRestart = interruptedWorkflow.nodes.filter(node => node.status === 'succeeded').map(node => node.nodeKey)

  await stopServer(server)
  server = undefined
  ;({ child: server, url } = await startServer())
  await json(`/api/novel-studio/v1/workflows/${interruptedWorkflow.id}/resume`, { method: 'POST', body: '{}' })
  const resumedWorkflow = await waitForWorkflow(interruptedWorkflow.id, 'waiting_approval')
  if (resumedWorkflow.status !== 'waiting_approval' || resumedWorkflow.canonFacts.length !== 0) throw new Error(`Workflow did not recover to approval without Canon: ${JSON.stringify(resumedWorkflow)}`)
  for (const nodeKey of successfulBeforeRestart) {
    if (resumedWorkflow.nodes.filter(node => node.nodeKey === nodeKey).length !== 1) throw new Error(`Successful node ${nodeKey} executed more than once after restart`)
  }
  const rejectedVersionId = resumedWorkflow.approval.manuscriptVersionId
  const rejectedWorkflow = await json(`/api/novel-studio/v1/workflows/${interruptedWorkflow.id}/approval`, { method: 'POST', body: JSON.stringify({ decision: 'rejected', note: 'Composition revision request.' }) })
  if (rejectedWorkflow.status !== 'waiting_approval' || rejectedWorkflow.approval.manuscriptVersionId === rejectedVersionId || rejectedWorkflow.canonFacts.length !== 0) throw new Error(`Workflow rejection did not create a new non-Canon version: ${JSON.stringify(rejectedWorkflow)}`)
  await json(`/api/novel-studio/v1/workflows/${interruptedWorkflow.id}/approval`, { method: 'POST', body: JSON.stringify({ decision: 'approved', note: 'Composition approval.' }) })
  const completedWorkflow = await waitForWorkflow(interruptedWorkflow.id, 'succeeded')
  if (completedWorkflow.status !== 'succeeded' || completedWorkflow.canonFacts.length !== 1 || completedWorkflow.canonCandidates[0]?.status !== 'committed') throw new Error(`Workflow approval did not atomically commit Canon: ${JSON.stringify(completedWorkflow)}`)
  const currentKnowledge = await json(`/api/novel-studio/v1/projects/${projectId}/knowledge`)
  if (currentKnowledge.summaries.length < 6 || currentKnowledge.timeline.length < 1 || currentKnowledge.entities.length < 1) throw new Error(`Approved chapter did not refresh Phase 4 knowledge: ${JSON.stringify(currentKnowledge)}`)
  for (const scope of ['foundation','chapter','arc','volume','book','project']) if (!currentKnowledge.summaries.some(summary => summary.scope === scope && summary.compactNarrative)) throw new Error(`Long-novel memory is missing ${scope}: ${JSON.stringify(currentKnowledge.summaries)}`)

  const historicalProject = await json('/api/novel-studio/v1/projects', { method: 'POST', body: JSON.stringify({ title: 'Historical Structure Reference', genre: 'test-history' }) })
  await buildFoundation(historicalProject.project.id)
  const historicalChapter = await json(`/api/novel-studio/v1/projects/${historicalProject.project.id}/chapters`, { method: 'POST', body: JSON.stringify({ title: 'Historical Chapter' }) })
  const historicalRunStarted = await json(`/api/novel-studio/v1/chapters/${historicalChapter.id}/workflows`, { method: 'POST', body: '{}' })
  const historicalWaiting = await waitForWorkflow(historicalRunStarted.id, 'waiting_approval')
  await json(`/api/novel-studio/v1/workflows/${historicalWaiting.id}/approval`, { method: 'POST', body: JSON.stringify({ decision: 'approved', note: 'Build historical summary.' }) })
  await waitForWorkflow(historicalWaiting.id, 'succeeded')
  await json(`/api/novel-studio/v1/projects/${projectId}/knowledge-sources/${historicalProject.project.id}`, { method: 'POST', body: JSON.stringify({ enabled: true, scopes: ['structure_summary'] }) })
  const selectedRunStarted = await json(`/api/novel-studio/v1/chapters/${chapter.id}/workflows`, { method: 'POST', body: '{}' })
  const selectedWaiting = await waitForWorkflow(selectedRunStarted.id, 'waiting_approval')
  if (!selectedWaiting.knowledgeSelectionSnapshot?.items.some(item => item.sourceProjectId === historicalProject.project.id && item.scopes.includes('structure_summary'))) throw new Error(`Historical selection was not frozen: ${JSON.stringify(selectedWaiting.knowledgeSelectionSnapshot)}`)
  if (!selectedWaiting.retrievalBundle?.items.some(item => item.authority === 'historical_reference' && item.content.startsWith('[Historical reference:'))) throw new Error(`Historical source was not cited in retrieval: ${JSON.stringify(selectedWaiting.retrievalBundle)}`)
  if (selectedWaiting.retrievalBundle.items.some(item => item.authority === 'historical_reference' && item.kind === 'approved_excerpt')) throw new Error('Historical original text was used without explicit permission')
  await json(`/api/novel-studio/v1/workflows/${selectedWaiting.id}/cancel`, { method: 'POST', body: '{}' })
  const excludedRun = await json(`/api/novel-studio/v1/chapters/${chapter.id}/workflows`, { method: 'POST', body: JSON.stringify({ excludedSourceIds: [historicalProject.project.id] }) })
  if (!excludedRun.knowledgeSelectionSnapshot.excludedSourceIds.includes(historicalProject.project.id) || excludedRun.knowledgeSelectionSnapshot.items.length !== 0) throw new Error(`Excluded source remained in immutable snapshot: ${JSON.stringify(excludedRun.knowledgeSelectionSnapshot)}`)
  await json(`/api/novel-studio/v1/workflows/${excludedRun.id}/cancel`, { method: 'POST', body: '{}' })
  const recoverySessionId = 'composition-recovery-session'
  const unboundResponse = await fetch(`${url}/api/novel-studio/v1/recovery/composition-new-session`)
  if (unboundResponse.status !== 404) throw new Error(`An unbound Session resumed without explicit project selection (${unboundResponse.status})`)
  await json('/api/novel-studio/v1/workspace', { method: 'POST', body: JSON.stringify({ projectId, chapterId: chapter.id, sessionId: recoverySessionId }) })
  const recovery = await json(`/api/novel-studio/v1/recovery/${recoverySessionId}`)
  if (recovery.project.id !== projectId || recovery.chapter.id !== chapter.id || recovery.capsule.schemaVersion !== 1) throw new Error(`Recovery Capsule did not bind the Session: ${JSON.stringify(recovery)}`)
  if (JSON.stringify(recovery).includes('Second immutable version survives restart.')) throw new Error('Recovery context leaked manuscript text')
  const explicitlySelected = await json('/api/novel-studio/v1/recovery/composition-new-session', { method: 'POST', body: JSON.stringify({ projectId }) })
  if (explicitlySelected.project.id !== projectId || explicitlySelected.chapter !== null) throw new Error(`New Session could not explicitly select the project: ${JSON.stringify(explicitlySelected)}`)
  const recovered = await json('/api/novel-studio/v1/workspace')
  if (recovered.selectedProjectId !== projectId || recovered.selectedChapterId !== chapter.id || recovered.selectedChapter.versions.length < 5) {
    throw new Error(`Restart recovery failed: ${JSON.stringify(recovered)}`)
  }
  if (recovered.selectedChapter.currentApprovedVersionId !== rejectedWorkflow.approval.manuscriptVersionId) throw new Error('Workflow-approved version was not recovered')

  await stopServer(server)
  server = undefined
  await run(['plugin', '--profile', 'web', 'remove', '@novel-studio/dsh-novel-studio'])
  const removedProfile = JSON.parse(await readFile(join(profileDir, 'package.json'), 'utf8'))
  if (removedProfile.dsh.profile.bundles.includes('@novel-studio/dsh-novel-studio')) throw new Error('Official plugin removal did not remove the Bundle from composition')
  await access(join(isolatedHome, 'data', 'novel-studio', 'novel-studio.db'))

  await run(['plugin', '--profile', 'web', 'add', installSpec])
  ;({ child: server, url } = await startServer())
  const afterReinstall = await json('/api/novel-studio/v1/workspace')
  if (afterReinstall.selectedProjectId !== projectId || afterReinstall.selectedChapter?.versions.length < 5) {
    throw new Error(`Data did not survive code uninstall and reinstall: ${JSON.stringify(afterReinstall)}`)
  }

  await writeFile(join(isolatedHome, 'phase4-smoke-result.json'), JSON.stringify({ url, doctor, doctorTool, projectId, chapterId: chapter.id, workflowRunId: interruptedWorkflow.id }, null, 2))
  console.log(JSON.stringify({
    ok: true,
    harness: '0.1.0-rc.7',
    installArtifact: installSpec.endsWith('.tgz') ? 'npm-tarball' : 'local-directory',
    bundleInstalled: true,
    hostReady: true,
    doctorReady: true,
    doctorExecuted: true,
    clientManifestReady: true,
    databaseReady: true,
    projectCreated: true,
    chapterCreated: true,
    immutableVersions: 2,
    versionApproved: true,
    selectionRewriteIsolated: true,
    promptVersionSelected: true,
    scenePlanGenerated: true,
    chapterDraftGenerated: true,
    chapterLiveManuscriptReady: true,
    chapterGrowthMapReady: true,
    projectGenerationStatisticsReady: true,
    threeStageFoundationReady: true,
    draftFirstFoundationReady: true,
    postDraftRevisionQuestionsReady: true,
    charactersLiveGenerationReady: true,
    timelineLiveGenerationReady: true,
    foundationProgressPersistenceReady: true,
    foundationLiveManuscriptReady: true,
    foundationPlannerAnswersApplied: true,
    dynamicPromptAssemblyReady: true,
    generationTraceReady: true,
    generationPulseReady: true,
    longNovelMemoryReady: true,
    promptBudgetTraceReady: true,
    promptHistoryImmutable: true,
    workflowRestartRecovered: true,
    successfulNodesIdempotent: true,
    rejectionCreatedNewVersion: true,
    canonBlockedBeforeApproval: true,
    canonCommittedAfterApproval: true,
    knowledgeIndexesRefreshed: true,
    historicalSelectionFrozen: true,
    historicalOriginalDisabledByDefault: true,
    sourceExclusionSnapshotReady: true,
    recoveryToolReady: true,
    recoveryCapsuleReady: true,
    recoveryContainsNoManuscript: true,
    newSessionExplicitSelectionReady: true,
    restartRecovered: true,
    uninstallPreservedData: true,
  }, null, 2))
} finally {
  await stopServer(server)
  await rm(isolatedHome, { recursive: true, force: true })
}
