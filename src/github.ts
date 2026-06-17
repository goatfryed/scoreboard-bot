import { Octokit } from '@octokit/rest';
import AdmZip from 'adm-zip';
import dotenv from 'dotenv';

// Load env files
dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

const owner = process.env.GITHUB_OWNER || '';
const repo = process.env.GITHUB_REPO || '';
const workflowId = process.env.GITHUB_WORKFLOW_ID || 'parse-clip.yml';
const auth = process.env.GITHUB_PAT || '';

if (!owner || !repo || !auth) {
  console.warn('WARNING: GitHub environment variables (GITHUB_OWNER, GITHUB_REPO, GITHUB_PAT) are not fully configured.');
}

const octokit = new Octokit({ auth });

export interface ArtifactFile {
  name: string;
  buffer: Buffer;
}

/**
 * Dispatches the workflow and returns the run ID.
 */
export async function dispatchWorkflow(clipUrl: string, mode: string): Promise<number> {
  const response = await octokit.request('POST /repos/{owner}/{repo}/actions/workflows/{workflow_id}/dispatches', {
    owner,
    repo,
    workflow_id: workflowId,
    ref: 'main',
    inputs: {
      clip_url: clipUrl,
      mode: mode,
    },
    return_run_details: true,
  });

  const runId = (response.data as any).run_id;
  if (!runId) {
    throw new Error('Workflow was dispatched, but no run ID was returned in the response.');
  }

  return runId;
}

/**
 * Polls the status of the workflow run until it is completed.
 * Throws an error if the run fails, is cancelled, or times out.
 */
export async function pollWorkflowRun(runId: number, intervalMs = 15000, timeoutMs = 600000): Promise<string> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    const { data: run } = await octokit.actions.getWorkflowRun({
      owner,
      repo,
      run_id: runId,
    });

    if (run.status === 'completed') {
      if (run.conclusion === 'success') {
        return 'success';
      } else {
        throw new Error(`Workflow run completed with non-success conclusion: ${run.conclusion}`);
      }
    }

    // Wait before polling again
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error('Workflow run polling timed out.');
}

/**
 * Downloads and extracts PNG screenshots from the workflow run artifacts.
 */
export async function downloadArtifacts(runId: number): Promise<ArtifactFile[]> {
  const { data } = await octokit.actions.listWorkflowRunArtifacts({
    owner,
    repo,
    run_id: runId,
  });

  const pngFiles: ArtifactFile[] = [];

  for (const artifact of data.artifacts) {
    // Download the artifact archive (ZIP)
    const downloadResponse = await octokit.actions.downloadArtifact({
      owner,
      repo,
      artifact_id: artifact.id,
      archive_format: 'zip',
    });

    const buffer = Buffer.from(downloadResponse.data as ArrayBuffer);
    const zip = new AdmZip(buffer);
    const entries = zip.getEntries();

    for (const entry of entries) {
      if (!entry.isDirectory && entry.entryName.toLowerCase().endsWith('.png')) {
        pngFiles.push({
          name: entry.name,
          buffer: entry.getData(),
        });
      }
    }
  }

  return pngFiles;
}
