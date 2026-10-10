# GreenEdge

A voice-guided navigation app with a document reader and an emergency SOS feature.

## Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Prerequisites](#prerequisites)
- [Running Locally](#running-locally)
- [Environment Variables](#environment-variables)
- [Deployment (Render + Docker)](#deployment-render--docker)
- [Pre-Deployment Checklist](#pre-deployment-checklist)
- [Important Notes](#important-notes)
- [Troubleshooting](#troubleshooting)
- [Security](#security)

## Overview

GreenEdge helps users get around and stay safe using voice. It combines:

- **Voice-guided navigation** with object detection from the camera feed
- **Document reader** that reads documents aloud
- **Emergency SOS** that alerts contacts over WhatsApp and shares a live tracking link

## Features

- Voice assistant for hands-free control
- Real-time object detection (YOLOv8s) for navigation assistance
- Document reader
- Emergency SOS with WhatsApp alerts (WhatsApp Cloud API)
- Live location tracking link (`public/track.html`)
- User login with signed-cookie sessions
- HTTPS support locally via mkcert, automatic HTTPS on Render

## Architecture

GreenEdge is made up of three parts:

| Component | Technology | Where it runs |
|---|---|---|
| Web backend | Node.js (Express) + MongoDB | Main host (Render) |
| Voice assistant | Flask (`python/voice_assistance.py`, port `5001`) | Runs inside the Node deployment |
| Object detection | YOLOv8s | Separate service, separate host |

The browser talks to the Node server for pages, login, SOS and tracking. The Node server talks to the Flask voice service on port `5001`. The navigation page's JavaScript sends camera frames to the separate object detection service at `/api/process_frame`.

## Tech Stack

- **Backend:** Node.js, Express
- **Database:** MongoDB (Atlas)
- **Voice assistant:** Python, Flask
- **Object detection:** YOLOv8s
- **Views:** EJS templates
- **Messaging:** WhatsApp Cloud API
- **Deployment:** Docker on Render

## Project Structure

```
.
├── server.js                  # Express server entry point
├── database/
│   └── db.js                  # MongoDB connection
├── python/
│   └── voice_assistance.py    # Flask voice assistant (port 5001)
├── public/                    # Static files
│   ├── css/
│   ├── js/
│   └── track.html             # Live tracking page
├── views/                     # EJS pages
├── Dockerfile
├── .dockerignore
└── package.json
```

## Prerequisites

- Node.js and npm
- Python 3.13 (the Windows `py` launcher is used in the commands below)
- A MongoDB Atlas cluster and its connection string
- A WhatsApp Cloud API account (phone number ID and a permanent access token)
- *(Optional, for local HTTPS)* [mkcert](https://github.com/FiloSottile/mkcert)
- A deployed object detection (YOLOv8s) service

## Running Locally

1. **Install dependencies**

   ```bash
   npm install
   ```

2. **Create a `.env` file** in the project root. See [Environment Variables](#environment-variables).

3. **Start the voice service** (port `5001`):

   ```bash
   py -3.13 python/voice_assistance.py
   ```

4. **Start the server** (in a second terminal):

   ```bash
   node server.js
   ```

If an mkcert certificate is found, the server runs on **HTTPS**. Otherwise it runs on plain **HTTP**.

> The camera, microphone and GPS only work on HTTPS (or `localhost`). Use mkcert if you need to test from another device on your network.

## Environment Variables

| Name | Purpose |
|---|---|
| `MONGODB_URI` | MongoDB Atlas connection string |
| `MONGODB_DB` | Database name (default: `greenedge`) |
| `SESSION_SECRET` | A long random string used to sign sessions and cookies |
| `WHATSAPP_PHONE_NUMBER_ID` | WhatsApp Cloud API phone number ID |
| `WHATSAPP_ACCESS_TOKEN` | WhatsApp Cloud API permanent access token |
| `PUBLIC_BASE_URL` | The public URL after deployment, e.g. `https://greenedge.onrender.com` (no trailing `/`). Without it, the live tracking link can't be generated |

Example `.env`:

```env
MONGODB_URI=mongodb+srv://<user>:<password>@<cluster>.mongodb.net/
MONGODB_DB=greenedge
SESSION_SECRET=replace-with-a-long-random-string
WHATSAPP_PHONE_NUMBER_ID=your_phone_number_id
WHATSAPP_ACCESS_TOKEN=your_permanent_token
PUBLIC_BASE_URL=https://greenedge.onrender.com
```

> **Never push `.env` to GitHub.** Make sure it is listed in `.gitignore`, and add these variables in your hosting provider's dashboard instead.

## Deployment (Render + Docker)

1. Push the code to GitHub (**without** `.env`).
2. On Render, create a **New Web Service** and select your repository.
3. Set **Runtime** to **Docker**.
4. Add all [environment variables](#environment-variables) in the Render dashboard.
5. Click **Deploy**. The first deploy takes a few minutes.
6. Once live, set `PUBLIC_BASE_URL` to your Render URL and redeploy if needed.

## Pre-Deployment Checklist

Check these before you deploy:

- [ ] At the end of `python/voice_assistance.py`, the app runs as:

  ```python
  app.run(host="0.0.0.0", port=5001, debug=False)
  ```

- [ ] In the **deployment copy** of `python/voice_assistance.py`, add this line right after the `is_mobile = bool(...)` line. The server has no laptop microphone:

  ```python
  is_mobile = True
  ```

  Do **not** keep this line in your laptop copy.

- [ ] `package-lock.json` is in the project (required for `npm ci`).
- [ ] The object detection URL is set (see below).
- [ ] `.env` is **not** committed.

**About `/location` and `/call`:** the laptop-microphone scripts used by these routes cannot run on the server. Once `is_mobile = True` is set, the assistant does not use them.

### Setting the object detection URL

The object detection service lives on a separate host. In the navigation page's JavaScript, set the `/api/process_frame` URL to your detection service's URL, for example:

```js
const DETECTION_URL = "https://your-detection-service.example.com/api/process_frame";
```

## Important Notes

- **Cold starts:** Render's free service goes to sleep after 15 minutes without traffic and takes about a minute to wake up. Open the site before a demo.
- **Sessions:** Login sessions and live tracking sessions are stored in server memory, so they reset when the server restarts. The user is still recognized through a signed cookie.
- **HTTPS:** Camera, microphone and GPS require HTTPS. Render provides it automatically.
- **Separate services:** The object detection service is deployed and scaled independently of the main app.

## Troubleshooting

| Problem | Likely cause and fix |
|---|---|
| Live tracking link is not created | `PUBLIC_BASE_URL` is missing or has a trailing `/` |
| Camera, mic or GPS not working | The page is not on HTTPS. Use mkcert locally, or the Render URL |
| Voice assistant fails on the server | `is_mobile = True` is missing in the deployment copy |
| `npm ci` fails during Docker build | `package-lock.json` is missing from the project |
| Site is slow on first load | Render free tier is waking up. Wait about a minute |
| Users are logged out after a restart | Sessions are held in memory by design. Log in again |
| Object detection does nothing | The detection URL in the navigation JS is not set or is unreachable |
| WhatsApp alerts not sent | Check `WHATSAPP_PHONE_NUMBER_ID` and `WHATSAPP_ACCESS_TOKEN` |

## Security

- Never commit `.env` or any secrets to version control.
- Use a long, random `SESSION_SECRET`.
- Use a permanent WhatsApp token stored only in your host's environment settings.
- If a secret is ever pushed by mistake, rotate it immediately.
