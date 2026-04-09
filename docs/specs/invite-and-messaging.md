# Invite Co-Owners & Messaging System — PM Spec

## Problem
Currently co-owners are added by pasting raw EOA addresses. No way to:
- Select from existing users who already have agents
- Invite new people who don't have accounts yet
- Notify anyone about pending ownership offers
- Accept/decline ownership invitations

## Features

### Feature 1: Select Existing Person as Co-Owner

**Flow:**
1. On agent settings or org deploy, click "Add Co-Owner"
2. Dropdown/search shows existing people who have person agents
3. Select a person → their EOA is used for `addOwner()`
4. Notification sent to that person: "You've been added as co-owner of [Org Name]"

### Feature 2: Invite New Person via Invite Code

**Flow:**
1. Click "Invite New Person"
2. System generates a unique invite code (stored in DB)
3. Share the invite link: `/invite/[code]`
4. New person opens link → connects wallet via Privy → completes onboarding
5. System auto-adds them as co-owner of the org agent
6. Notification: "You've been added as co-owner of [Org Name]"

**Invite record:**
```
invites {
  id: text PK
  code: text unique
  agentAddress: text       // the org agent
  role: text               // 'owner' | 'admin' | 'member'
  createdBy: text           // user ID of inviter
  expiresAt: text
  acceptedBy: text | null
  acceptedAt: text | null
  status: 'pending' | 'accepted' | 'expired' | 'revoked'
}
```

### Feature 3: Messaging / Notification System

**Notification types:**
- `ownership_offered` — you've been offered co-ownership
- `ownership_accepted` — someone accepted your invite
- `relationship_proposed` — someone proposed a relationship to your agent
- `relationship_confirmed` — your relationship was confirmed
- `relationship_rejected` — your relationship was rejected
- `review_received` — your agent received a review
- `dispute_filed` — a dispute was filed against your agent
- `proposal_created` — a governance proposal needs your vote
- `proposal_executed` — a proposal you voted on was executed

**Message record:**
```
messages {
  id: text PK
  userId: text             // recipient
  type: text               // notification type
  title: text
  body: text
  link: text | null        // deep link to relevant page
  read: integer default 0
  createdAt: text
}
```

**UI:**
- Bell icon in header with unread count badge
- Dropdown shows recent messages
- Click message → navigate to relevant page
- "Mark all read" button
- Messages page for full history

## Implementation Plan

### Sprint 1: DB Schema + Messaging API
- [ ] Add `invites` table to schema
- [ ] Add `messages` table to schema
- [ ] `POST /api/messages` — create message
- [ ] `GET /api/messages` — get messages for current user
- [ ] `PUT /api/messages/[id]` — mark read
- [ ] Push DB schema

### Sprint 2: Notification Bell UI
- [ ] `NotificationBell` component in header
- [ ] Polls `/api/messages` for unread count
- [ ] Dropdown with recent messages
- [ ] Click navigates to link
- [ ] Mark read on click

### Sprint 3: Select Existing Person
- [ ] `GET /api/agents/people` — list all person agents with names
- [ ] Update agent settings: searchable person selector
- [ ] On select → addOwner + create notification
- [ ] Update deploy org flow to use selector

### Sprint 4: Invite Code Flow
- [ ] `POST /api/invites` — generate invite code
- [ ] `/invite/[code]` page — connect wallet, accept, onboard
- [ ] `POST /api/invites/[code]/accept` — accept invite, add as owner
- [ ] Notification to inviter when accepted
- [ ] Invite management on agent settings page (view, revoke)

### Sprint 5: Wire Notifications into Existing Flows
- [ ] Relationship proposed → notify object owner
- [ ] Relationship confirmed/rejected → notify subject
- [ ] Review received → notify subject
- [ ] Dispute filed → notify subject
- [ ] Governance proposal → notify all owners
