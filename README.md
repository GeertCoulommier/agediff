# AgeDiff – Docker Build Demo

A birthday calculator web application that demonstrates building and running Docker containers. Enter
your date of birth and the app shows a live breakdown of your age — down to the second — plus a
countdown to your next birthday, with a special celebration on the day itself.

> **⚠️ Disclaimer:** This project was built with AI assistance (GitHub Copilot / Claude). It is
> intended solely as a Docker learning exercise. The application code — including the Express server,
> Nginx configuration, and frontend JavaScript — is **not** intended as a reference implementation or
> production-ready example. Do not use it as a template for real-world projects without thorough review.

## Features

- **Age breakdown** – years, months, days, hours, minutes, seconds since birth
- **Two views** – component breakdown *and* total-in-each-unit view
- **Next-birthday countdown** – live-ticking countdown to your next birthday
- **Birthday celebration** – confetti animation and congratulations banner on the day
- **Summary text file** – auto-generated plain-text report with ASCII bar chart, written to a
  host-mounted volume (`./output/age_summary.txt`)
- **Live updating** – the display recalculates every second without further API calls

## Architecture

```
┌──────────────┐       ┌────────────────────┐       ┌─────────────────┐
│   Browser    │──────>│  Nginx (frontend)  │──────>│  Node.js API    │
│              │  :80  │  Static files +    │ :4000 │  Age calculator  │
│              │<──────│  Reverse proxy     │<──────│  Rate limiting   │
└──────────────┘       └────────────────────┘       └────────┬────────┘
                                                             │
                                                      ┌──────┴──────┐
                                                      │ Bind mount  │
                                                      │ ./output/   │
                                                      └─────────────┘
```

- **Frontend** – Nginx serves static HTML/CSS/JS and reverse-proxies `/api/*` to the backend
- **Backend** – Express.js calculates the age, generates a summary text file, and responds with JSON
  - **Rate limiting** – max 60 req/min per IP at the Express layer
  - **Nginx rate limiting** – additional 10 req/s limit at the reverse proxy layer
  - **Summary file** – written to `/app/output/` (bind-mounted to `./output/` on the host)

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) installed
- [Docker Compose](https://docs.docker.com/compose/install/) installed (for the Compose workflow)

> **Port 80:** Both workflows expose the app on port 80. If another process is already using port 80
> on your machine, replace `80:80` with an alternative like `8080:80` and access via
> `http://localhost:8080`.

> **Accessing the app:** The URLs in this guide use `localhost`, which works when your browser runs
> on the same machine as Docker. If Docker is running on a remote server or VM, replace `localhost`
> with the hostname or IP address of that machine — for example `http://192.168.1.50` or
> `http://myserver.local`.

---

## 📖 How to Use This Guide

**This README provides educational guidance without showing full commands.** Your task is to research and construct the actual Docker commands based on the descriptions provided. All complete command examples are available in [README_FULL.md](README_FULL.md) if you need to verify your work or get unstuck.

This approach encourages hands-on learning and helps you understand what each Docker command does, rather than just copying and pasting.

---

## Getting the Repository

### Using Git (recommended)

If you have Git installed:

```bash
git clone https://github.com/GeertCoulommier/agediff.git
cd agediff
```

### Using Windows Package Manager (winget) + ZIP Download

On Windows, you can use winget to install `curl` and `unzip`, then download the repository as a ZIP file:

1. **Install curl and unzip** (if not already installed):
   ```bash
   winget install -q curl
   winget install -q GnuWin32.UnZip
   ```

2. **Download the repository as a ZIP file**:
   ```bash
   curl -L https://github.com/GeertCoulommier/agediff/archive/refs/heads/main.zip -o agediff.zip
   ```

3. **Extract the ZIP file**:
   ```bash
   unzip -q agediff.zip
   cd agediff-main
   ```

### On macOS or Linux without Git

You can use `curl` and `unzip` (usually pre-installed):

```bash
curl -L https://github.com/GeertCoulommier/agediff/archive/refs/heads/main.zip -o agediff.zip
unzip -q agediff.zip
cd agediff-main
```

### Option 1 – Git Clone (recommended)

If you have Git installed, clone the repository from GitHub to your local machine.

### Option 2 – Download as ZIP (Windows/macOS without Git)

If you don't have Git installed:

1. **On Windows with winget:** Install the unzip tool using your package manager if needed
2. **Download the repository:** Visit the GitHub repository and download it as a ZIP file, or use a
   command-line tool to download the ZIP from the repository's archive URL
3. **Extract the ZIP:** Use your unzip tool to extract the downloaded file
4. **Navigate:** Change into the extracted directory

---

## Option A – Docker CLI (no Compose)

This workflow uses raw `docker` commands. For detailed command examples, see [README_FULL.md](README_FULL.md).

This workflow teaches you how Docker works by running commands individually, so you can see exactly what each step does.

### Step 1 – Create the output directory

Create a directory that will receive the summary text file from the backend container via a bind mount.

### Step 2 – Create a shared Docker network

Create a network that allows your containers to communicate with each other by name. This isolates
them from other containers and the host system.

### Step 3 – Build the backend image

Build the Docker image for the Node.js backend. Use the `Dockerfile` in the `backend/` directory.
The Docker layer cache should skip the `npm ci` step on subsequent builds if only your application
code changes (not `package.json`).

### Step 4 – Build the frontend image

Build the Docker image for the Nginx frontend. Use the `Dockerfile` in the `frontend/` directory.
The static files and Nginx configuration should be baked into the image at build time.

### Step 5 – Start the backend container

Run the backend container. For reference, use the suggested container name `agediff-backend` and the image you built in Step 3. The following is already configured and provided — you only need to add the container name, the volume mount, and the image:

Pre-configured network and environment settings:
```
--network agediff-net \
--network-alias backend \
--restart unless-stopped \
-e PORT=4000 \
-e OUTPUT_DIR=/app/output \
-e NODE_ENV=production \
```

**Your task:** Construct a `docker run` command that combines:
- Detached mode (`-d` flag)
- The container name: `agediff-backend`
- The pre-configured settings above
- A volume mount (bind mount) connecting the host's `./output` directory to the container's `/app/output` directory
- The image name from Step 3

Consult [README_FULL.md](README_FULL.md) for a complete example if needed.

### Step 6 – Start the frontend container

Run the frontend container with:
- Detached mode
- A container name
- Network attachment (same network as the backend)
- Port mapping (80 on host → 80 in container)
- Restart policy

Open **http://localhost** in your browser.

---

### Useful Commands (Docker CLI)

#### View logs

```bash
# Follow live logs for a container (Ctrl-C to stop)
docker logs -f agediff-backend
docker logs -f agediff-frontend

# Show only the last 50 lines
docker logs --tail 50 agediff-backend
```

Morgan (backend) and Nginx (frontend) log every request. Watching both helps you trace the full path
of a request and spot errors from either layer.

#### Check container status and health

```bash
# List running containers with ports and health status
docker ps

# Inspect the health-check result specifically
docker inspect --format '{{.State.Health.Status}}' agediff-backend
docker inspect --format '{{.State.Health.Status}}' agediff-frontend
```

The `HEALTHCHECK` instructions in both Dockerfiles periodically poll `/api/health` and
`/nginx-health`. Docker marks a container `healthy`, `unhealthy`, or `starting` accordingly.

#### Open a shell inside a container

```bash
docker exec -it agediff-backend sh
docker exec -it agediff-frontend sh
```

Useful for debugging — inspect files, run one-off commands, or check environment variables with
`printenv`.

#### Check the generated summary file

```bash
cat output/age_summary.txt
```

This file is regenerated every time you submit a birthday in the UI.

#### Stop and remove the containers

```bash
# Stop both containers gracefully (SIGTERM → SIGKILL after timeout)
docker stop agediff-frontend agediff-backend

# Remove the stopped containers (frees the names for next run)
docker rm agediff-frontend agediff-backend

# Remove the network
docker network rm agediff-net
```

Stop the frontend first so Nginx is no longer accepting new requests before the backend disappears.

#### Rebuild after code changes

```bash
# Rebuild images (unchanged layers are served from cache)
docker build -t agediff-backend ./backend
docker build -t agediff-frontend ./frontend

# Replace the running containers
docker stop agediff-frontend agediff-backend
docker rm   agediff-frontend agediff-backend

# Re-run steps 5 & 6
```

---

## Option B – Docker Compose

Compose manages the entire multi-container application from a single `docker-compose.yml` file. It
handles network creation, dependency ordering, volume mounts, and full lifecycle control — replacing
all the individual `docker` commands above with single-line shortcuts.

### Step 1 – Create the output directory

```bash
mkdir -p output
```

Compose will bind-mount this directory into the backend container. The summary text file appears
here after your first calculation.

### Step 2 – Build all images

```bash
docker compose build
```

Reads the `build.context` and `build.dockerfile` for every service in `docker-compose.yml` and
builds them. Docker's layer cache is used exactly as with the manual `docker build` commands, so
repeated builds are fast. To rebuild a single service only:

```bash
docker compose build backend
```

### Step 3 – Start all services

```bash
docker compose up -d
```

Compose performs these steps automatically:

1. Creates the `app-network` bridge network declared in `docker-compose.yml`
2. Starts `backend` first (because `frontend` declares `depends_on: [backend]`)
3. Starts `frontend`, publishing the host port

The `-d` flag (detached) returns control to your terminal. Without it Compose streams all logs to
stdout and blocks until you press Ctrl-C.

Open **http://localhost** in your browser.
For detailed command examples, see [README_FULL.md](README_FULL.md).

Compose manages the entire multi-container application from a single `docker-compose.yml` file.
Instead of running individual `docker` commands, Compose handles network creation, dependency ordering,
volume mounts, and full lifecycle control with simple commands.

### Step 1 – Create the output directory

Create the output directory that Compose will bind-mount into the backend container. The summary
text file will appear here after your first calculation.

### Step 2 – Build all images

Use the Docker Compose build command to read the build context and Dockerfile for each service
defined in `docker-compose.yml` and build them. Docker's layer cache applies here too, so repeated
builds are fast. You can also build individual services if needed.

### Step 3 – Start all services

Use the Docker Compose up command with the detached flag. Compose will automatically:

1. Create the bridge network declared in the Compose file
2. Start the backend first (because the frontend declares a dependency on it)
3. Start the frontend, publishing the host port
4. Set up volume mounts (output directory)

### Combined build + start

You can also combine build and start into a single command using the build flag with the up command.
Use this whenever you change application cat output/age_summary.txt
```

#### Stop containers (keep images and volumes)

```bash
docker compose stop
```

Gracefully stops all containers without removing them or the network. Use `docker compose start` to
bring them back up instantly (no rebuild required).

#### Stop and remove everything

```bash
docker compose down
```

Stops and removes the containers and the network. Images are retained so a subsequent
`docker compose up -d` is fast.

To also remove the images:

```bash
docker compose down --rmi all
```

#### Rebuild after code changes

```bash
docker compose up --build -d
```

Compose rebuilds only the images whose source has changed (Docker layer cache), then recreates the
affected containers in-place. Services with unchanged images are left running.

---

## Project Structure

```
agediff/
├── docker-compose.yml        # Orchestrates both services + volume mount
├── .gitignore
├── README.md
├── output/                   # Bind-mounted volume (git-ignored)
│   └── age_summary.txt      # Generated summary with ASCII bar chart
├── backend/
│   ├── Dockerfile            # Node.js 20 Alpine image
│   ├── .dockerignore         # Keeps node_modules out of build context
│   ├── package.json
│   └── server.js             # Express API with age calculation & file generation
└── frontend/
    ├── Dockerfile            # Nginx Alpine image
    ├── .dockerignore
    ├── nginx.conf            # Reverse proxy + rate limiting config
    ├── index.html
    ├── css/
    │   └── styles.css
    └── js/
        └── app.js            # Vanilla JS with live-updating counters
```

---

## Key Docker Concepts Demonstrated
                 # Quick-start guide (simplified instructions)
├── README_FULL.md            # Complete guide with full command examples
| Concept | Where |
|---------|-------|
| Multi-service orchestration | `docker-compose.yml` |
| Custom build contexts | `backend/Dockerfile`, `frontend/Dockerfile` |
| Inter-container networking | `app-network` bridge, `proxy_pass http://backend:4000` |
| Network aliases | `--network-alias backend` (CLI) / service name (Compose) |
| Bind-mount volumes | `./output:/app/output` — summary file accessible on host |
| Health checks | `HEALTHCHECK` in both Dockerfiles |
| Non-root user (UID 1000) | Backend runs as `appuser` for bind-mount compatibility |
| Layer caching optimisation | `COPY package.json` before `COPY .` |
| `.dockerignore` | Keeps `node_modules` out of the build context |
| Internal-only services | Backend has no published ports; reachable only via Nginx |

---

## The Summary File

Every time you submit a birthday, the backend writes `output/age_summary.txt` containing:

- Full component breakdown and totals for time-since-birth
- Component breakdown and totals for time-until-next-birthday
- ASCII horizontal bar chart visualising the age components
- On your birthday: ASCII-art cake with congratulations

Example excerpt:

```
+=========================================================+
|             AGE DIFFERENCE - Summary Report              |
+=========================================================+

  Birthday:    1990-05-15
  Calculated:  2026-02-23T14:30:00.000Z

-- Time Since Birth --------------------------------------

  Component Breakdown:
    35 years, 9 months, 8 days,
    14 hours, 30 minutes, 0 seconds

  Total in Each Unit:
    Years:   35
    Months:  429
    Days:    13,068
    Hours:   313,646
    Minutes: 18,818,760
    Seconds: 1,129,125,600

  Visual Breakdown:
    Years   #################################### 35
    Months  ################                     9
    ...
```
