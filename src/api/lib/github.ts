// src/api/lib/github.ts — GitHub API client for Cloudflare Workers (crypto.subtle)

export interface GitHubTreeItem {
  path: string;
  mode: string;
  type: 'blob' | 'tree';
  sha: string;
  size?: number;
  url: string;
}

export interface GitHubTreeResponse {
  sha: string;
  url: string;
  tree: GitHubTreeItem[];
  truncated: boolean;
}

export interface GitHubContentItem {
  name: string;
  path: string;
  sha: string;
  size: number;
  type: 'file' | 'dir';
  content?: string;
  encoding?: string;
  download_url: string | null;
}

export interface GitHubRepo {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  html_url: string;
  description: string | null;
  default_branch: string;
}

export interface GitHubInstallationTokenResponse {
  token: string;
  expires_at: string;
  permissions: Record<string, string>;
}

export class GitHubClient {
  private token: string;
  private baseUrl = 'https://api.github.com';

  constructor(token: string) {
    this.token = token;
  }

  private async request<T>(path: string): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`GitHub API ${res.status}: ${body}`);
    }
    return res.json() as Promise<T>;
  }

  async getRepoContents(owner: string, repo: string, path = ''): Promise<GitHubContentItem[]> {
    const result = await this.request<GitHubContentItem | GitHubContentItem[]>(
      `/repos/${owner}/${repo}/contents/${path}`,
    );
    return Array.isArray(result) ? result : [result];
  }

  async getTree(owner: string, repo: string, sha = 'HEAD', recursive = true): Promise<GitHubTreeResponse> {
    const suffix = recursive ? '?recursive=1' : '';
    return this.request<GitHubTreeResponse>(`/repos/${owner}/${repo}/git/trees/${sha}${suffix}`);
  }

  async getFileContent(owner: string, repo: string, path: string): Promise<string> {
    const item = await this.request<GitHubContentItem>(`/repos/${owner}/${repo}/contents/${path}`);
    if (!item.content) throw new Error(`No content for ${path}`);
    return atob(item.content.replace(/\n/g, ''));
  }

  async listInstallationRepos(): Promise<GitHubRepo[]> {
    const result = await this.request<{ repositories: GitHubRepo[] }>('/installation/repositories');
    return result.repositories;
  }
}

/** Base64url encode a buffer (no padding). */
function base64url(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let str = '';
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Create a JWT signed with RS256 for GitHub App authentication. */
async function createAppJwt(appId: string, privateKeyPem: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = { iss: appId, iat: now - 60, exp: now + 600 };

  const enc = new TextEncoder();
  const headerB64 = base64url(enc.encode(JSON.stringify(header)).buffer as ArrayBuffer);
  const payloadB64 = base64url(enc.encode(JSON.stringify(payload)).buffer as ArrayBuffer);
  const signingInput = `${headerB64}.${payloadB64}`;

  // Import PEM private key
  const pemBody = privateKeyPem
    .replace(/-----BEGIN RSA PRIVATE KEY-----/, '')
    .replace(/-----END RSA PRIVATE KEY-----/, '')
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s/g, '');
  const binaryDer = Uint8Array.from(atob(pemBody), (c) => c.charCodeAt(0));

  const key = await crypto.subtle.importKey(
    'pkcs8',
    binaryDer.buffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, enc.encode(signingInput));
  return `${signingInput}.${base64url(sig)}`;
}

/** Get an installation access token from GitHub. */
export async function createInstallationToken(
  installationId: string,
  appId: string,
  privateKey: string,
): Promise<GitHubInstallationTokenResponse> {
  const jwt = await createAppJwt(appId, privateKey);

  const res = await fetch(`https://api.github.com/app/installations/${installationId}/access_tokens`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${jwt}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub installation token ${res.status}: ${body}`);
  }

  return res.json() as Promise<GitHubInstallationTokenResponse>;
}

/** Refresh an expired installation token. */
export async function refreshInstallationToken(
  installationId: string,
  appId: string,
  privateKey: string,
): Promise<GitHubInstallationTokenResponse> {
  return createInstallationToken(installationId, appId, privateKey);
}
