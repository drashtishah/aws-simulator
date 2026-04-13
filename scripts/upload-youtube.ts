import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { youtube, auth } from '@googleapis/youtube';
import { OAuth2Client } from 'google-auth-library';
import open from 'open';

const ROOT = path.resolve(__dirname, '..');
const CLIENT_SECRET_PATH = path.join(ROOT, 'client_secret.json');
const CREDS_PATH = path.join(ROOT, '.youtube-creds.json');
const VIDEOS_DIR = path.join(ROOT, 'learning', 'videos');
const ENV_PATH = path.join(ROOT, '.env');

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

async function uploadVideo(filePath: string, oauth2Client: OAuth2Client): Promise<void> {
  const title = path.basename(filePath, path.extname(filePath));
  const stat = fs.statSync(filePath);
  const yt = youtube({ version: 'v3', auth: oauth2Client });

  const res = await yt.videos.insert(
    {
      part: ['snippet', 'status'],
      requestBody: {
        snippet: {
          title,
          description: 'AWS Incident Simulator session recording',
        },
        status: { privacyStatus: 'unlisted' },
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

  const oauth2Client = await getTokens();

  const files = discoverVideos(VIDEOS_DIR);
  if (files.length === 0) {
    console.log('No .mp4 files in learning/videos/.');
    return;
  }

  console.log(`Uploading ${files.length} video(s)...`);
  for (const file of files) {
    await uploadVideo(path.join(VIDEOS_DIR, file), oauth2Client);
  }
}

if (process.argv[1] === __filename) {
  main().catch(err => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
