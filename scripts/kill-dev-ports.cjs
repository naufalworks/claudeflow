#!/usr/bin/env node
const { execSync } = require('child_process');

const ports = [20129, 3129, 3130, 8080];

for (const port of ports) {
  let pids = [];
  try {
    const out = execSync(`lsof -tiTCP:${port} -sTCP:LISTEN`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    pids = out.split(/\s+/).filter(Boolean);
  } catch {
    pids = [];
  }

  if (pids.length === 0) {
    console.log(`✓ port ${port} free`);
    continue;
  }

  for (const pid of pids) {
    try {
      process.kill(Number(pid), 'SIGTERM');
      console.log(`✓ stopped pid ${pid} on port ${port}`);
    } catch (error) {
      console.warn(`⚠ failed SIGTERM pid ${pid} on port ${port}: ${error.message}`);
    }
  }
}

setTimeout(() => {
  for (const port of ports) {
    let pids = [];
    try {
      const out = execSync(`lsof -tiTCP:${port} -sTCP:LISTEN`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      pids = out.split(/\s+/).filter(Boolean);
    } catch {
      pids = [];
    }

    for (const pid of pids) {
      try {
        process.kill(Number(pid), 'SIGKILL');
        console.log(`✓ force-stopped pid ${pid} on port ${port}`);
      } catch (error) {
        console.warn(`⚠ failed SIGKILL pid ${pid} on port ${port}: ${error.message}`);
      }
    }
  }
}, 500);
