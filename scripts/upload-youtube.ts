// YouTube Upload Script
//
// Usage:
//   npm run upload -- --file <filename> --title "<title>" [--sim <simId>]
//
// Agent instructions:
//   The user will provide:
//     1. --file  (required): the .mp4 filename in learning/videos/ (e.g. session-2026-04-13T14-20-24-829Z.mp4)
//     2. --title (required): the YouTube video title (e.g. "Debugging an unreachable EC2")
//     3. --sim  (optional): the simulation ID (e.g. 001-ec2-unreachable)
//   If --sim is provided, the script looks up the sim's summary from sims/registry.json for the YouTube description.
//   If --sim is omitted, the video uploads with no description.
//   Auth tokens are cached in .youtube-creds.json. If missing, the script opens a browser for OAuth.
//   Videos upload as public.

import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { youtube, auth } from '@googleapis/youtube';
import { OAuth2Client } from 'google-auth-library';
import open from 'open';

const ROOT = path.resolve(__dirname, '..');
const CLIENT_SECRET_PATH = path.join(ROOT, 'client_secret.json');
const CREDS_PATH = path.join(ROOT, '.youtube-creds.json');
const VIDEOS_DIR = process.env.AWS_SIMULATOR_VIDEOS_DIR ?? path.join(ROOT, 'learning', 'videos');
const ENV_PATH = path.join(ROOT, '.env');
const REGISTRY_PATH = path.join(ROOT, 'sims', 'registry.json');

export function readEnvFlag(envPath: string): boolean {
  if (!fs.existsSync(envPath)) return false;
  const content = fs.readFileSync(envPath, 'utf8');
  const match = content.match(/^YOUTUBE_UPLOAD\s*=\s*(.+)$/m);
  return match?.[1]?.trim() === 'true';
}

interface ClientSecret {
  installed?: { client_id: string; client_secret: string };
  web?: { client_id: string; client_secret: string };
}

export function parseClientSecret(json: string): { client_id: string; client_secret: string } {
  const secret: ClientSecret = JSON.parse(json);
  const creds = secret.installed ?? secret.web;
  if (!creds) throw new Error('client_secret.json: no installed or web key');
  return creds;
}

export function discoverVideos(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(f => f.endsWith('.mp4'));
}

interface RegistrySim {
  id: string;
  title: string;
  summary: string;
}

export function lookupSimSummary(registryPath: string, simId: string): string {
  if (!fs.existsSync(registryPath)) {
    throw new Error(`Registry not found: ${registryPath}`);
  }
  const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
  const sim = registry.sims.find((s: RegistrySim) => s.id === simId);
  if (!sim) {
    throw new Error(`Sim "${simId}" not found in registry. Available: ${registry.sims.map((s: RegistrySim) => s.id).join(', ')}`);
  }
  return sim.summary;
}

function parseArgs(argv: string[]): { file: string; title: string; sim: string | undefined } {
  const args = argv.slice(2);
  let file = '';
  let title = '';
  let sim: string | undefined;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--file' && args[i + 1]) file = args[++i]!;
    else if (args[i] === '--title' && args[i + 1]) title = args[++i]!;
    else if (args[i] === '--sim' && args[i + 1]) sim = args[++i]!;
  }
  if (!file || !title) {
    console.error('Usage: npm run upload -- --file <filename> --title "<title>" [--sim <simId>]');
    process.exit(1);
  }
  return { file, title, sim };
}

const REDIRECT_URI = 'http://localhost:3333';

async function getTokens(): Promise<OAuth2Client> {
  const creds = parseClientSecret(fs.readFileSync(CLIENT_SECRET_PATH, 'utf8'));

  const oauth2Client = new auth.OAuth2(creds.client_id, creds.client_secret, REDIRECT_URI);

  if (fs.existsSync(CREDS_PATH)) {
    oauth2Client.setCredentials(JSON.parse(fs.readFileSync(CREDS_PATH, 'utf8')));
    return oauth2Client;
  }

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/youtube.upload'],
  });

  console.log('Opening browser for OAuth authorization...');
  await open(authUrl);

  const code = await new Promise<string>((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://localhost:3333');
      const code = url.searchParams.get('code');
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<h1>Authorization complete. You may close this tab.</h1>');
      server.close();
      if (code) resolve(code);
      else reject(new Error('No code in OAuth callback'));
    });
    server.listen(3333);
  });

  const { tokens } = await oauth2Client.getToken(code);
  oauth2Client.setCredentials(tokens);
  fs.writeFileSync(CREDS_PATH, JSON.stringify(tokens, null, 2));
  console.log('Tokens saved to .youtube-creds.json');
  return oauth2Client;
}

async function uploadVideo(
  filePath: string,
  title: string,
  description: string,
  oauth2Client: OAuth2Client,
): Promise<void> {
  const stat = fs.statSync(filePath);
  const yt = youtube({ version: 'v3', auth: oauth2Client });

  const res = await yt.videos.insert(
    {
      part: ['snippet', 'status'],
      requestBody: {
        snippet: { title, description },
        status: { privacyStatus: 'public' },
      },
      media: { body: fs.createReadStream(filePath) },
    },
    {
      onUploadProgress: (evt: { bytesRead: number }) => {
        const pct = Math.round((evt.bytesRead / stat.size) * 100);
        process.stdout.write(`\r  ${title}: ${pct}%`);
      },
    },
  );

  console.log(`\n  Uploaded: https://youtu.be/${res.data.id ?? 'unknown'}`);
}

async function main(): Promise<void> {
  if (!readEnvFlag(ENV_PATH)) {
    console.log('YouTube upload disabled. Set YOUTUBE_UPLOAD=true in .env to enable.');
    process.exit(0);
  }

  if (!fs.existsSync(CLIENT_SECRET_PATH)) {
    console.error('client_secret.json not found. Download it from Google Cloud Console.');
    process.exit(1);
  }

  const { file, title, sim } = parseArgs(process.argv);
  const filePath = path.join(VIDEOS_DIR, file);

  if (!fs.existsSync(filePath)) {
    const available = discoverVideos(VIDEOS_DIR);
    console.error(`File not found: ${filePath}`);
    if (available.length > 0) {
      console.error(`Available videos: ${available.join(', ')}`);
    }
    process.exit(1);
  }

  const description = sim ? lookupSimSummary(REGISTRY_PATH, sim) : '';

  const oauth2Client = await getTokens();

  console.log(`Uploading "${title}" (${file})...`);
  if (description) console.log(`Description: ${description}`);
  await uploadVideo(filePath, title, description, oauth2Client);
}

if (process.argv[1] === __filename) {
  main().catch(err => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
