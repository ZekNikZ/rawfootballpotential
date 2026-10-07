# Automatic deploys: the self-hosted GitHub Actions runner

CI (`ci.yml`) and the image builds (`release.yml`) run on GitHub-hosted runners. Only the **Deploy** workflow
(`.github/workflows/deploy.yml`) runs on a self-hosted runner installed on the production server.

```
merge to main -> Release images (GitHub-hosted: builds + pushes ghcr.io/zeknikz/rfp-*:<sha>)
              -> Deploy (self-hosted, on the server): backup -> RFP_TAG=<sha> -> compose pull/up -> wait for health
                 -> roll back to the previous tag if it never becomes healthy
```

It assumes the server was set up with `infra/setup-server.sh` (stack in `/opt/rfp`, `.env` there).

## What a deploy does

1. Waits for the **Release images** run of a push to `main` to succeed (tag builds and failed builds never deploy).
2. Logs in to GHCR with the workflow's own token (read-only for packages), so private packages work.
3. Checks that `/opt/rfp/.env` has every variable `docker-compose.yml` requires (names only are reported, never values), then
   `docker compose run --rm backup once` (a database dump in `/opt/rfp/backups` before anything changes).
4. Copies `docker-compose.yml` from the deployed commit into `/opt/rfp`, sets `RFP_TAG` in `.env` to the commit SHA,
   `docker compose pull`, `docker compose up -d --remove-orphans`. The `migrate` container runs migrations first; the worker
   re-derives seasons whose `DERIVE_VERSION` is behind and the API pre-warms the record cache.
5. Polls `http://127.0.0.1:<WEB_PORT>/api/healthz` for up to 5 minutes. If it never answers, it restores the previous
   `docker-compose.yml` and `RFP_TAG`, starts that version, and fails the run. **Migrations are not reversed** (they are additive).

A manual deploy or rollback: GitHub -> Actions -> **Deploy** -> Run workflow, with `tag` set to a full commit SHA, a version
such as `1.2.0`, or empty for the latest main build. Deploys never run concurrently.

`.env` is only read one value at a time and never printed. New variables a release needs must be added to `/opt/rfp/.env`
by hand (compare with `.env.example`) _before_ merging; the workflow does not manage secrets.

## One-time setup

### 1. On the server

Run as an admin user. Pick a dedicated user for the runner (docker group membership is effectively root on this host, so
keep the machine for this stack and keep the repository private or restrict who can run workflows; see "Security").

```sh
sudo useradd --create-home --shell /bin/bash rfp-runner
sudo usermod -aG docker rfp-runner
sudo chown -R rfp-runner:rfp-runner /opt/rfp      # it must be able to edit .env and docker-compose.yml, and read backups
```

(If you have not run the setup script yet, `sudo RUNNER_USER=rfp-runner ./infra/setup-server.sh` does these three steps.)

Check that the user can use Docker and the stack:

```sh
sudo -u rfp-runner -H bash -lc 'docker info >/dev/null && cd /opt/rfp && docker compose ps'
```

The stack must already be running once (data restored, owner created; `docs/cutover.md` sections 3 and 5) before automatic deploys make sense.

### 2. Register the runner on GitHub

In the repository: **Settings -> Actions -> Runners -> New self-hosted runner -> Linux**, architecture to match the server
(`uname -m`: x64 or arm64). GitHub shows the exact, current commands and a short-lived registration token. Run them as
`rfp-runner` (not root), in `~/actions-runner`:

```sh
sudo -iu rfp-runner
mkdir actions-runner && cd actions-runner
# ...the "Download" commands from the GitHub page (curl + tar)...
./config.sh --url https://github.com/ZekNikZ/rawfootballpotential --token <TOKEN-FROM-THE-PAGE> \
  --name rfp-prod --labels rfp-prod --unattended --replace
exit
```

The workflow's `runs-on` is `[self-hosted, linux, rfp-prod]`; the labels `self-hosted` and `linux` are added automatically
and `rfp-prod` comes from `--labels`.

### 3. Run it as a service (starts at boot, restarts on failure)

```sh
cd /home/rfp-runner/actions-runner
sudo ./svc.sh install rfp-runner
sudo ./svc.sh start
sudo ./svc.sh status
```

The runner then shows as **Idle** under Settings -> Actions -> Runners. It only needs outbound HTTPS to GitHub (no open
inbound port). If you add the user to the `docker` group after the service started, restart it (`sudo ./svc.sh stop && sudo ./svc.sh start`).

### 4. GitHub settings

- **Settings -> Environments -> New environment `production`** (the Deploy job uses it). Optionally add yourself as a
  required reviewer to approve each deploy by hand; leave it empty for fully automatic deploys.
- **Settings -> Actions -> General -> Workflow permissions:** the workflows ask for what they need
  (`packages: write` for Release, `packages: read` for Deploy), so the default can stay "read".
- If the GHCR packages (`rfp-api`, `rfp-ingest`, ...) are private: for each package, **Package settings -> Manage Actions
  access -> add this repository** (read). Otherwise the deploy's `docker login` token cannot pull them.
- Protect `main` (require the CI check and a PR) because a merge to `main` now means a production deploy.

### 5. Test it

1. Actions -> **Deploy** -> Run workflow (branch `main`, empty tag). Watch the steps; it ends with `docker compose ps` and the health JSON.
2. Then make a trivial change through a PR, merge it, and watch Release images -> Deploy run on their own.
3. Try the rollback path once on purpose if you want to see it: run Deploy with a nonexistent tag. The pull fails before
   anything restarts, so the running version stays up.

## Security

A self-hosted runner executes whatever workflow code is given to it, with docker (root-equivalent) access to the server.

- Keep the repository **private**, or never let forks' pull requests run on it. Only `deploy.yml` uses the runner and it only
  triggers on a finished Release run of `main` or by hand; do not add `runs-on: self-hosted` to workflows that run on `pull_request`.
- Only people with write access to the repository can edit workflows or run Deploy by hand; keep that list short and use branch protection.
- The registration token from the GitHub page expires within an hour and is used once; it is not stored.
- The runner user has no sudo. It does hold the docker group and owns `/opt/rfp` (including `.env`).

## Maintenance

- The runner updates itself. To see why it is offline: `sudo ./svc.sh status` and `journalctl -u 'actions.runner.*' -n 100`.
- Remove it: `sudo ./svc.sh stop && sudo ./svc.sh uninstall`, then `./config.sh remove --token <TOKEN>` (token from the same GitHub page).
- Disk: the workflow prunes images older than a week; backups in `/opt/rfp/backups` are kept for 14 days by the backup container.
- To deploy by hand without GitHub: edit `RFP_TAG` in `/opt/rfp/.env`, then `docker compose pull && docker compose up -d`.
