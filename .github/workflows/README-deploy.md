# Deploying from GitHub instead of your machine

`deploy.yml` builds and deploys Hostel Analyzer to Firebase Hosting on GitHub's
servers. Use it because deploying locally fails: outbound TLS connections from
this machine to `*.googleapis.com` are reset (`curl: (35) Recv failure`), which
breaks the Firebase CLI regardless of what flags it's given.

Once set up, every push to `main` publishes the site. You never run
`firebase deploy` locally again.

---

## One-time setup (~5 minutes)

### 1. Get a Firebase service account key

This is what lets GitHub deploy as you.

1. Open the [Firebase service accounts page](https://console.firebase.google.com/project/hostel-analyzer/settings/serviceaccounts/adminsdk)
   (Firebase console → ⚙ Project settings → Service accounts)
2. Click **Generate new private key** → **Generate key**
3. A `.json` file downloads. Open it in a text editor and copy the **entire
   contents**, braces included.

Treat that file like a password — it grants write access to your Firebase
project. Delete it from your Downloads folder once step 2 is done.

### 2. Add it as a repository secret

1. Go to your repo → **Settings** → **Secrets and variables** → **Actions**
2. **New repository secret**
   - Name: `FIREBASE_SERVICE_ACCOUNT`
   - Secret: paste the whole JSON from step 1
3. **Add secret**

### 3. Add your Gemini key (optional)

Same screen, **New repository secret**:

- Name: `GEMINI_API_KEY`
- Secret: your Gemini API key

Skip this if you don't want AI features in the deployed build. The app builds
and runs fine without it — translation, sentiment and AI insights just stay
disabled, and the existing "no API key" banner explains why.

Note this key ends up in the browser bundle, visible to anyone who views the
site. That's how the app works today. Moving it server-side needs a Cloud
Function proxy (that was part of the reverted work, if you want it back).

### 4. Push, or run it by hand

```
git add .github
git commit -m "ci: deploy to Firebase Hosting from GitHub Actions"
git push
```

Or, without pushing anything: repo → **Actions** → **Deploy to Firebase
Hosting** → **Run workflow**.

Watch it under the Actions tab. First run takes ~2-3 minutes.

---

## What the workflow does

| Step | Purpose |
|---|---|
| `npm ci` | Clean install from `package-lock.json`, on Linux |
| `npx tsc --noEmit` | Type check — fails the deploy on a type error |
| `npm test` | Runs the test suite |
| `npm run build` | Vite production build into `dist/` |
| `action-hosting-deploy` | Publishes `dist/` to the `live` channel |

Because it runs `npm ci` on Linux, it also avoids the platform-binary problem
you hit locally: a `node_modules` installed on Windows carries
`@esbuild/win32-x64`, which won't run anywhere else.

---

## Troubleshooting

**"Error: Failed to authenticate"** — the `FIREBASE_SERVICE_ACCOUNT` secret is
missing, truncated, or isn't valid JSON. Re-copy the file contents in full,
including the opening and closing braces.

**Tests or type check fail** — the deploy stops before publishing, so the live
site is untouched. Fix locally, push again.

**"HTTP Error: 403"** — the service account lacks Firebase Hosting permission.
In Google Cloud IAM, grant it **Firebase Hosting Admin**.

**Wrong project** — `projectId: hostel-analyzer` in `deploy.yml` must match
`.firebaserc`.

---

## Firestore rules are not deployed here

This workflow publishes hosting only. Rules changes still need:

```
npx firebase deploy --only firestore
```

which runs into the same local network problem. Two ways around it: edit the
rules directly in the Firebase console (Firestore → Rules → Publish), or add a
rules step to this workflow.

Right now the live rules require authentication (from a deploy that went
through earlier), while the local `firestore.rules` are permissive. Until they
match, cloud sync stays denied. Publishing the local rules via the console
resolves it — reviews are stored in localStorage either way, so no data is at
risk.
