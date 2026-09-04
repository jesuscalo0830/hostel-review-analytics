# Who can use the app

Signing in with Google is not enough. A caller must also appear on an
allowlist stored in Firestore at `config/allowlist`.

The addresses live in Firestore rather than in `firestore.rules` so they stay
out of this public repo, and so people can be added or removed without
redeploying rules.

## Create the allowlist (required — nobody can sign in until this exists)

[Firestore → Data](https://console.firebase.google.com/project/hostel-analyzer/firestore/data)

1. **Start collection** → collection ID `config`
2. Document ID: `allowlist` (exactly — the rules read this path)
3. Add two fields, both of type **array**:

| Field | Type | Value |
|---|---|---|
| `emails` | array of strings | `jesus.calo0830@gmail.com`, `jt@vibe-collective.cc` |
| `domains` | array of strings | `vibe-collective.cc` |

4. **Save**, then deploy the rules: `npm run deploy:rules`

`domains` admits every Google account on that domain, which is the easy way
to onboard colleagues. `emails` covers individuals outside it — the Gmail
address is there because that is the account currently used to administer
the Firebase project.

Emails are compared lowercase, so casing in the console does not matter.

## Adding or removing someone

Edit the arrays in the Firestore console. Changes take effect immediately —
no deploy, no rebuild. Removing someone revokes access on their next request.

## Notes

**Unverified accounts are rejected.** The rules require
`email_verified == true`, so an account claiming an allowlisted address
without having verified it does not get in.

**The allowlist is readable by any signed-in user, and writable by nobody.**
It has to be readable because the rules engine evaluates it on the caller's
behalf. It is not client-writable on purpose: otherwise one allowlisted user
could add anyone, and a mistake could lock everyone out. Edit it in the
console.

**Every allowlisted user can edit all reviews.** Access is per-account, not
per-row. The workspace is shared by design. Deletion is denied for everyone,
including allowlisted users.

## If you lock yourself out

Rules never restrict the Firebase console. Sign in there as project owner and
fix the `config/allowlist` document; access is restored on the next request.

## Cost

Each rules evaluation reads `config/allowlist`. Firestore does not bill for
`get()` calls made inside rules, so this does not add to your document read
count.
