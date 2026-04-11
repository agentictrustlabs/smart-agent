#!/usr/bin/env bash
set -euo pipefail

# Seeds Togo-specific operational data: revenue reports, training completions,
# capital movements, and governance proposals.
# Run AFTER seed-ilad-mc.sh and seed-togo-pilot.sh

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "=== Seeding Togo Operational Data ==="

cd "$ROOT_DIR/apps/web"

node -e "
const Database = require('better-sqlite3');
const db = new Database('local.db');
const ts = () => new Date().toISOString();
const id = () => require('crypto').randomUUID();

// ─── Run migrations for new tables ──────────────────────────────────
const migrations = [
  'revenue_reports', 'capital_movements', 'training_modules',
  'training_completions', 'proposals', 'votes'
];
for (const table of migrations) {
  try { db.prepare('SELECT 1 FROM ' + table + ' LIMIT 1').get(); }
  catch {
    console.log('Creating table: ' + table);
    const fs = require('fs');
    const sql = fs.readFileSync('$ROOT_DIR/apps/web/drizzle/0001_togo_features.sql', 'utf-8');
    // Execute each statement
    for (const stmt of sql.split('--> statement-breakpoint')) {
      const trimmed = stmt.trim();
      if (trimmed && trimmed.startsWith('CREATE')) {
        try { db.prepare(trimmed).run(); } catch (e) { /* already exists */ }
      }
    }
    break;
  }
}

// ─── Training Modules (BDC Curriculum) ──────────────────────────────
const modules = [
  { id: 'bdc-01', name: 'Business Foundations', desc: 'Basic accounting, business planning, and market analysis', hours: 16, sort: 1 },
  { id: 'bdc-02', name: 'Financial Literacy', desc: 'Cash flow management, pricing, and basic bookkeeping', hours: 12, sort: 2 },
  { id: 'bdc-03', name: 'Marketing & Sales', desc: 'Customer acquisition, branding, and sales techniques', hours: 8, sort: 3 },
  { id: 'bdc-04', name: 'Operations Management', desc: 'Inventory, supply chain, quality control', hours: 8, sort: 4 },
  { id: 'bdc-05', name: 'Digital Skills', desc: 'Mobile payments, digital record-keeping, social media', hours: 6, sort: 5 },
  { id: 'bdc-06', name: 'Leadership & Team Management', desc: 'Hiring, delegation, team development', hours: 6, sort: 6 },
  { id: 'bdc-07', name: 'Revenue-Sharing Orientation', desc: 'Understanding the revenue-sharing model, reporting requirements', hours: 4, sort: 7 },
  { id: 'bdc-08', name: 'Growth Planning', desc: 'Scaling strategy, reinvestment, wave progression planning', hours: 6, sort: 8 },
];

for (const m of modules) {
  const exists = db.prepare('SELECT id FROM training_modules WHERE id = ?').get(m.id);
  if (!exists) {
    db.prepare('INSERT INTO training_modules (id,name,description,program,hours,sort_order,created_at) VALUES (?,?,?,?,?,?,?)').run(m.id, m.name, m.desc, 'bdc', m.hours, m.sort, ts());
  }
}
console.log('Training modules: 8 BDC modules seeded');

// ─── Get user & org IDs ─────────────────────────────────────────────
// Togo pilot users
const kofi = db.prepare('SELECT id FROM users WHERE id = ?').get('tg-user-001');
const ama = db.prepare('SELECT id FROM users WHERE id = ?').get('tg-user-002');
const edem = db.prepare('SELECT id FROM users WHERE id = ?').get('tg-user-003');
const akosua = db.prepare('SELECT id FROM users WHERE id = ?').get('tg-user-004');
const yao = db.prepare('SELECT id FROM users WHERE id = ?').get('tg-user-005');
const essi = db.prepare('SELECT id FROM users WHERE id = ?').get('tg-user-006');
const kokou = db.prepare('SELECT id FROM users WHERE id = ?').get('tg-user-007');
const lawrence = db.prepare('SELECT id FROM users WHERE id = ?').get('tg-user-008');

// MC users
const john = db.prepare('SELECT id FROM users WHERE id = ?').get('mc-user-001');
const cameron = db.prepare('SELECT id FROM users WHERE id = ?').get('mc-user-002');
const paul = db.prepare('SELECT id FROM users WHERE id = ?').get('mc-user-005');

// Portfolio business orgs
const allOrgs = db.prepare('SELECT smart_account_address, name, template_id FROM org_agents').all();
const bizOrgs = allOrgs.filter(o => o.template_id === 'portfolio-business');
const cilOrg = allOrgs.find(o => o.name === 'Collective Impact Labs');
const oocOrg = allOrgs.find(o => o.name === 'Oversight Committee');

if (!kofi || !ama || bizOrgs.length === 0) {
  console.log('Skipping data seed — run seed-togo-pilot.sh first');
  process.exit(0);
}

// ─── Revenue Reports (6 months for each Wave 1 business) ────────────
const months = ['2025-10', '2025-11', '2025-12', '2026-01', '2026-02', '2026-03'];
const bizOwnerMap = {
  'tg-user-001': 'Café Lomé',
  'tg-user-002': 'Mama Afi Restaurant',
  'tg-user-003': 'TechFix Lomé',
  'tg-user-004': \"Couture d Or\",
  'tg-user-005': 'AgriPlus Togo',
};

// Revenue patterns per business (monthly gross revenue in XOF)
const revPatterns = {
  'tg-user-001': [450000, 480000, 520000, 550000, 600000, 650000], // growing coffee shop
  'tg-user-002': [380000, 400000, 420000, 410000, 450000, 470000], // steady restaurant
  'tg-user-003': [300000, 350000, 400000, 380000, 420000, 460000], // growing tech repair
  'tg-user-004': [250000, 270000, 300000, 320000, 340000, 370000], // steady tailoring
  'tg-user-005': [200000, 180000, 220000, 250000, 280000, 310000], // seasonal agriculture
};

let reportCount = 0;
for (const [userId, bizName] of Object.entries(bizOwnerMap)) {
  const biz = bizOrgs.find(o => o.name === bizName);
  if (!biz) continue;
  const pattern = revPatterns[userId] || [300000, 310000, 320000, 330000, 340000, 350000];

  for (let i = 0; i < months.length; i++) {
    const existing = db.prepare('SELECT id FROM revenue_reports WHERE org_address = ? AND period = ?').get(biz.smart_account_address.toLowerCase(), months[i]);
    if (existing) continue;

    const gross = pattern[i];
    const expenses = Math.round(gross * (0.5 + Math.random() * 0.15));
    const net = gross - expenses;
    const share = Math.round(net * 0.10); // 10% revenue share

    db.prepare('INSERT INTO revenue_reports (id,org_address,submitted_by,period,gross_revenue,expenses,net_revenue,share_payment,currency,notes,verified_by,verified_at,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(id(), biz.smart_account_address.toLowerCase(), userId, months[i], gross, expenses, net, share,
        'XOF', null, cameron ? 'mc-user-002' : null, cameron ? ts() : null, i < 5 ? 'verified' : 'submitted', ts());
    reportCount++;
  }
}
console.log('Revenue reports: ' + reportCount + ' seeded');

// ─── Training Completions ───────────────────────────────────────────
// Each business owner has different training progress
const trainingProgress = {
  'tg-user-001': ['bdc-01', 'bdc-02', 'bdc-03', 'bdc-04', 'bdc-07'],  // Kofi: 5/8 (strong)
  'tg-user-002': ['bdc-01', 'bdc-02', 'bdc-03', 'bdc-07'],             // Ama: 4/8 (good)
  'tg-user-003': ['bdc-01', 'bdc-02', 'bdc-04', 'bdc-05', 'bdc-07'],  // Edem: 5/8 (strong)
  'tg-user-004': ['bdc-01', 'bdc-02', 'bdc-03'],                       // Akosua: 3/8 (in progress)
  'tg-user-005': ['bdc-01', 'bdc-02'],                                  // Yao: 2/8 (early)
};

let completionCount = 0;
for (const [userId, moduleIds] of Object.entries(trainingProgress)) {
  for (const moduleId of moduleIds) {
    const existing = db.prepare('SELECT id FROM training_completions WHERE user_id = ? AND module_id = ?').get(userId, moduleId);
    if (existing) continue;

    const score = 60 + Math.floor(Math.random() * 35); // 60-95
    db.prepare('INSERT INTO training_completions (id,user_id,module_id,assessed_by,score,notes,completed_at,created_at) VALUES (?,?,?,?,?,?,?,?)')
      .run(id(), userId, moduleId, kokou ? 'tg-user-007' : 'tg-user-008', score, null, ts(), ts());
    completionCount++;
  }
}
console.log('Training completions: ' + completionCount + ' seeded');

// ─── Capital Movements ──────────────────────────────────────────────
const treasuryAgent = db.prepare(\"SELECT smart_account_address FROM ai_agents WHERE name LIKE '%Treasury%' AND operated_by IS NOT NULL LIMIT 1\").get();
if (treasuryAgent) {
  const tAddr = treasuryAgent.smart_account_address;
  let capCount = 0;

  for (const biz of bizOrgs) {
    // Deploy capital
    const existing = db.prepare('SELECT id FROM capital_movements WHERE treasury_agent = ? AND counterparty = ? AND direction = ?').get(tAddr, biz.smart_account_address.toLowerCase(), 'deploy');
    if (!existing) {
      db.prepare('INSERT INTO capital_movements (id,treasury_agent,direction,counterparty,amount,currency,purpose,authorized_by,tx_hash,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
        .run(id(), tAddr, 'deploy', biz.smart_account_address.toLowerCase(), '1000000', 'XOF', 'Wave 1 seed capital', john ? 'mc-user-001' : null, null, 'confirmed', ts());
      capCount++;
    }
  }

  // Funder contribution
  const fundExists = db.prepare('SELECT id FROM capital_movements WHERE direction = ? AND purpose LIKE ?').get('fund', '%initial%');
  if (!fundExists && paul) {
    db.prepare('INSERT INTO capital_movements (id,treasury_agent,direction,counterparty,amount,currency,purpose,authorized_by,tx_hash,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
      .run(id(), tAddr, 'fund', '0x0000000000000000000000000000000000050005', '25000000000000000000', 'ETH', 'Paul Martel initial fund contribution (25 ETH)', 'mc-user-005', null, 'confirmed', ts());
    capCount++;
  }
  console.log('Capital movements: ' + capCount + ' seeded');
}

// ─── OOC Proposals ──────────────────────────────────────────────────
if (oocOrg) {
  const oocAddr = oocOrg.smart_account_address.toLowerCase();
  const existing = db.prepare('SELECT id FROM proposals WHERE org_address = ?').get(oocAddr);
  if (!existing) {
    // Q1 2026 quarterly review
    const p1 = id();
    db.prepare('INSERT INTO proposals (id,org_address,proposer,title,description,action_type,target_address,quorum_required,votes_for,votes_against,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(p1, oocAddr, 'mc-user-001', 'Q1 2026 Quarterly Review — Approve Wave 1 Continuation',
        'All 5 Wave 1 businesses have submitted 6 months of revenue reports. Average repayment rate is 62%. Recommend continuing all businesses in Wave 1 with current terms.',
        'general', null, 2, 2, 0, 'passed', '2026-04-01T10:00:00.000Z');

    // Votes for P1
    db.prepare('INSERT INTO votes (id,proposal_id,voter,vote,comment,created_at) VALUES (?,?,?,?,?,?)')
      .run(id(), p1, 'mc-user-001', 'for', 'Revenue data looks solid. Training completion needs attention for Yao.', '2026-04-01T10:30:00.000Z');
    db.prepare('INSERT INTO votes (id,proposal_id,voter,vote,comment,created_at) VALUES (?,?,?,?,?,?)')
      .run(id(), p1, 'mc-user-005', 'for', 'Agreed. The 62% recovery rate is ahead of projections.', '2026-04-01T11:00:00.000Z');

    // Open proposal
    const p2 = id();
    const agriOrg = bizOrgs.find(o => o.name === 'AgriPlus Togo');
    db.prepare('INSERT INTO proposals (id,org_address,proposer,title,description,action_type,target_address,quorum_required,votes_for,votes_against,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(p2, oocAddr, 'mc-user-002', 'Escalate Review — AgriPlus Togo Training Gap',
        'Yao at AgriPlus has only completed 2/8 BDC modules. Recommend requiring completion of modules 3 and 4 before next revenue-share review.',
        'escalate-review', agriOrg ? agriOrg.smart_account_address.toLowerCase() : null, 2, 1, 0, 'open', '2026-04-08T09:00:00.000Z');

    db.prepare('INSERT INTO votes (id,proposal_id,voter,vote,comment,created_at) VALUES (?,?,?,?,?,?)')
      .run(id(), p2, 'mc-user-002', 'for', 'Training fidelity is a leading indicator — we should act early.', '2026-04-08T09:30:00.000Z');

    console.log('Proposals: 2 seeded (1 passed, 1 open)');
  }
}

console.log('');
console.log('=== Togo operational data seeded ===');
console.log('  Revenue: 6 months × 5 businesses = 30 reports');
console.log('  Training: 19 module completions across 5 owners');
console.log('  Capital: 5 deployments + 1 funder contribution');
console.log('  Governance: 2 OOC proposals (1 passed, 1 open)');
"

echo ""
echo "=== Togo Data Seeding Complete ==="
