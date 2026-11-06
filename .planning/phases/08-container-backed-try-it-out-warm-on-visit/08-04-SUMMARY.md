---
phase: 08-container-backed-try-it-out-warm-on-visit
plan: 04
subsystem: try-it-out backend
tags: [zip, artifact, fflate, job-store]
requires: [08-01]
provides:
  - zipFiles / writeArtifactZip / zipOutputDir with 20 MB / 200 file caps and zip-slip guard
  - artifactZipPath, typed pushEvent(jobId, summary, type?, tool?), JobRecord.sessionKey
  - artifact route serving application/zip as aic-job-<id>.zip
affects: [08-06]
tech-stack:
  added: []
  patterns: [Dirent-based regular-file walk to skip symlinks]
key-files:
  created:
    - src/lib/server/tryitout/artifact.ts
    - src/lib/server/tryitout/artifact.test.ts
  modified:
    - src/lib/server/tryItOutJobs.ts
    - src/lib/server/tryItOutJobs.test.ts
    - src/lib/server/tryItOutRunner.ts
    - src/lib/server/tryItOutRunner.test.ts
    - src/routes/api/tryitout/jobs/[id]/artifact/+server.ts
    - src/routes/api/tryitout/jobs/jobs.test.ts
    - src/lib/tryItOut.ts
    - src/lib/tryItOut.test.ts
key-decisions:
  - "Fallback runner zips output/ after writing result.txt (D-14)"
requirements-completed: [D-13, D-14]
duration: 8 min
completed: 2026-10-08
---

# Phase 8 Plan 04: Zip artifact Summary

Artifact is now a zip of output/ end to end (fflate): runner writes result.txt then zips, route serves application/zip as aic-job-<id>.zip, client saves .zip, and the job store gained typed events and a server-only sessionKey.

## Tasks
1. Tracer: zip end to end - cb9a9dc
2. Typed pushEvent, sessionKey, zip cap and symlink tests - 3dbd9f5

## Deviations from Plan

Minor: the job-store source changes (artifactZipPath, pushEvent, sessionKey) were implemented alongside task 1 in commit cb9a9dc because they share files; task 2's commit holds their tests. The existing "artifact deleted" jobs test now removes artifact.zip. No behavior deviations.

## Verification
- All five plan test files pass; tsc shows no errors in touched files.
- GET status route does not reference sessionKey.

## Self-Check: PASSED
