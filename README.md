# DemoReady: record a PR demo

Record a polished demo video of every pull request's **preview deployment** and post it as a PR comment: thumbnail, watch link, MP4 and the scenes that played. The comment updates in place on every new deployment.

Two ways to record:

- **`from-demo`**: replay a demo you already made in DemoReady (web or AI-agent demo) on the preview. Deterministic, ideal for "show the onboarding flow on this branch". Works on every plan, including MCP.
- **`story`**: let DemoReady's AI record a new demo from a description. Needs Pro, Studio or a demo credit.

Each recording uses one demo from your DemoReady plan. A recording that fails before producing a video (for example, the preview was down) gives its demo back.

## Setup

1. Create an API key in DemoReady (**Settings → API & MCP**) and add it to your repository as the secret `DEMOREADY_API_KEY`.
2. Find the demo to replay: its ID is the last part of its URL, `https://demoready.ai/app/demos/<id>`.
3. Add a workflow.

### Vercel, Netlify and other deployment-status previews

```yaml
name: PR demo
on: deployment_status
permissions:
  pull-requests: write
jobs:
  demo:
    if: github.event.deployment_status.state == 'success' && github.event.deployment.environment != 'Production'
    runs-on: ubuntu-latest
    steps:
      - uses: Sundrylab/demoready-action@v1
        with:
          api-key: ${{ secrets.DEMOREADY_API_KEY }}
          url: ${{ github.event.deployment_status.environment_url }}
          from-demo: a1b2c3d4
```

### Your own preview step

```yaml
on: pull_request
permissions:
  pull-requests: write
jobs:
  demo:
    runs-on: ubuntu-latest
    steps:
      - id: preview
        run: echo "url=https://pr-${{ github.event.number }}.preview.example.com" >> "$GITHUB_OUTPUT"
      - uses: Sundrylab/demoready-action@v1
        with:
          api-key: ${{ secrets.DEMOREADY_API_KEY }}
          url: ${{ steps.preview.outputs.url }}
          story: "Sign up, create a first project and invite a teammate"
          style: bold
          music: upbeat
```

## Inputs

| Input | | |
| --- | --- | --- |
| `api-key` | required | DemoReady API key (use a secret) |
| `url` | required | The preview deployment to record |
| `from-demo` | one of these | Demo ID to replay on the preview |
| `story` | | What DemoReady's AI should show |
| `style` | optional | studio, clean, bold, aurora, terminal, editorial, neon, brutalist, playful, cinema, slate |
| `voice` | optional | Narration voice, e.g. `af_heart`, `bm_george` |
| `music` | optional | calm, upbeat, tech, warm, lofi, corporate, cinematic, house, playful, ambient, synthwave, jazz |
| `comment` | `true` | Post and update the PR comment |
| `fail-on-error` | `false` | Fail the step if recording fails |
| `timeout-minutes` | `20` | How long to wait |
| `server` | `https://demoready.ai` | DemoReady address |

## Outputs

`demo-id`, `share-url`, `video-url`, `status` (`done` or `failed`).

## Notes

- The preview must be reachable from the internet. For login-protected previews, save a test login for the preview's address in DemoReady (**Settings → Saved sites**), or use a demo that logs in off camera.
- Videos are shared by link so the PR comment can show them; turn sharing off in DemoReady at any time.
