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

## Option A – Docker CLI (no Compose)

This workflow uses raw `docker` commands so you can see exactly what each step does.

### Step 1 – Create the output directory

```bash
mkdir -p output
```

This directory will receive the summary text file from the backend container via a bind mount.

### Step 2 – Create a shared Docker network

```bash
docker network create agediff-net
```

Containers cannot talk to each other by name unless they share the same network. This creates an
isolated bridge network. Services on it can reach each other using their container name or alias as
a hostname. Nothing outside this network can initiate connections to them.

### Step 3 – Build the backend image

```bash
docker build -t agediff-backend ./backend
```

Docker reads `backend/Dockerfile`, executes each `RUN`/`COPY` instruction as a cacheable layer, and
tags the result `agediff-backend:latest`. Because `package.json` is copied before the application
source, the expensive `npm ci` step is skipped on subsequent builds whenever only app code changes.

### Step 4 – Build the frontend image

```bash
docker build -t agediff-frontend ./frontend
```

Same process for the Nginx image. The static files (HTML/CSS/JS) and the custom `nginx.conf`
(which includes the `/api/` reverse-proxy rule and rate-limiting zone) are baked into the image at
build time.

### Step 5 – Start the backend container

```bash
docker run -d \
  --name agediff-backend \
  --network agediff-net \
  --network-alias backend \
  --restart unless-stopped \
  -e PORT=4000 \
  -e OUTPUT_DIR=/app/output \
  -e NODE_ENV=production \
  -v "$(pwd)/output:/app/output" \
  agediff-backend
```

What each flag does:

| Flag | Purpose |
|------|---------|
| `-d` | Run in the background (detached mode) |
| `--name agediff-backend` | Give the container a human-readable name for subsequent commands |
| `--network agediff-net` | Attach it to the shared bridge network |
| `--network-alias backend` | Register the DNS name `backend` inside the network — Nginx resolves this hostname to forward API requests |
| `--restart unless-stopped` | Automatically restart after a crash or a Docker daemon restart |
| `-e PORT=4000` | Tell Node.js which port to listen on inside the container |
| `-e OUTPUT_DIR=/app/output` | Directory where the summary text file is written |
| `-v "$(pwd)/output:/app/output"` | Bind-mount the host `output/` directory into the container |

No port is published to the host (`-p` is absent). The backend is intentionally reachable only
through the internal network — all external traffic must go through Nginx.

### Step 6 – Start the frontend container

```bash
docker run -d \
  --name agediff-frontend \
  --network agediff-net \
  --restart unless-stopped \
  -p 80:80 \
  agediff-frontend
```

| Flag | Purpose |
|------|---------|
| `-p 80:80` | Map host port 80 → container port 80, making Nginx reachable from the browser |
| `--network agediff-net` | Same shared network, so Nginx can DNS-resolve the `backend` alias |

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

### Combined build + start

```bash
docker compose up --build -d
```

Equivalent to running `build` then `up -d` in one step. Use this whenever you change application
code and want to rebuild and restart without separate commands.

---

### Useful Commands (Docker Compose)

#### View logs

```bash
# Follow all services at once (colour-coded by service name)
docker compose logs -f

# Follow a single service
docker compose logs -f backend

# Show the last 100 lines from all services
docker compose logs --tail 100
```

Interleaved, colour-coded output makes it easy to trace a request as it flows from Nginx → Node.js
and back.

#### Check container status and health

```bash
# Show all service containers, their status, and exposed ports
docker compose ps

# Detailed health-check state
docker inspect --format '{{.State.Health.Status}}' agediff-backend
docker inspect --format '{{.State.Health.Status}}' agediff-frontend
```

#### Open a shell inside a service container

```bash
docker compose exec backend sh
docker compose exec frontend sh
```

#### Check the generated summary file

```bash
cat output/age_summary.txt
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
