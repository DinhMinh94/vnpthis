#!/usr/bin/env node
/**
 * Script quét và sửa lỗi danh mục thuốc HMIS (dọn log duclogthuocvattu có tenAtc === null
 * và chuẩn hóa dữ liệu thuốc theo chuẩn Angular UI để tránh lỗi HTTP 500 khi bấm Sửa -> Lưu F4).
 *
 * Cách dùng:
 *   node .agents/skills/sua-ma-thuoc-hmis/scripts/repair_station_drugs.js --station 11098 --dry-run
 *   node .agents/skills/sua-ma-thuoc-hmis/scripts/repair_station_drugs.js --station 11158 --thau-ghep ";;;2026" --verify
 *   node .agents/skills/sua-ma-thuoc-hmis/scripts/repair_station_drugs.js --all --dry-run
 */
const path = require('path');
const axios = require('axios');

const rootDir = path.resolve(__dirname, '../../../..');
const db = require(path.join(rootDir, 'server/services/db'));
const cauhinhService = require(path.join(rootDir, 'server/services/cauhinhService'));
const suaMaThuocService = require(path.join(rootDir, 'server/services/suaMaThuocService'));

function parseArgs(argv) {
  const args = {
    station: null,
    all: false,
    thauGhep: null,
    dryRun: false,
    verify: false
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--station' && argv[i + 1]) args.station = argv[++i];
    else if (a === '--all') args.all = true;
    else if (a === '--thau-ghep' && argv[i + 1]) args.thauGhep = argv[++i];
    else if (a === '--dry-run') args.dryRun = true;
    else if (a === '--verify') args.verify = true;
  }
  return args;
}

async function processStation(st, opts) {
  const auth = await cauhinhService.loginToHmis(st);
  const headers = {
    'Authorization': 'Bearer ' + auth.token,
    'region-code': auth.region,
    'Origin': auth.targetUrl.replace(/\/$/, ''),
    'Referer': auth.targetUrl
  };

  const targetMap = new Map(); // hmisId -> { ma, reason }

  // 1. Tìm tất cả log lỗi (tenAtc === null) trong pharmacy/duclogthuocvattu
  let page = 0;
  while (page < 20) {
    const res = await axios.get(
      `${auth.gateway}pharmacy/duclogthuocvattu/search?page=${page}&size=200&sort=id,asc&filter=csytId==1`,
      { headers, timeout: 15000 }
    );
    const content = res.data?.data?.content || [];
    for (const l of content) {
      if (l.tenAtc === null && l.thuocVatTuId) {
        if (!targetMap.has(l.thuocVatTuId)) {
          targetMap.set(l.thuocVatTuId, { ma: l.ma, reason: `corrupted_log(id=${l.id})` });
        }
      }
    }
    if (content.length < 200) break;
    page++;
  }

  // 2. Nếu có lọc theo thauGhep (ví dụ ;;;2026)
  if (opts.thauGhep) {
    let dp = 0;
    while (dp < 20) {
      const res = await axios.get(
        `${auth.gateway}common/dmthuoc/search?page=${dp}&size=200&sort=id,asc&filter=csytId==1`,
        { headers, timeout: 15000 }
      );
      const content = res.data?.data?.content || [];
      for (const d of content) {
        if (d.thauGhep && d.thauGhep.includes(opts.thauGhep)) {
          targetMap.set(d.id, { ma: d.ma, reason: `thauGhep(${d.thauGhep})` });
        }
      }
      if (content.length < 200) break;
      dp++;
    }
  }

  if (targetMap.size === 0) {
    console.log(`[${st.username}] OK - Không phát hiện thuốc lỗi.`);
    return;
  }

  console.log(`[${st.username}] Phát hiện ${targetMap.size} thuốc cần chuẩn hóa:`);
  for (const [tvtId, info] of targetMap.entries()) {
    if (opts.dryRun) {
      console.log(`  [DRY-RUN] ID=${tvtId} | ma=${info.ma} | reason=${info.reason}`);
      continue;
    }
    try {
      const r1 = await suaMaThuocService.updateSingleDrugOnHmis(auth, tvtId, info.ma);
      let ok2 = true;
      if (opts.verify) {
        const r2 = await suaMaThuocService.updateSingleDrugOnHmis(auth, tvtId, info.ma);
        ok2 = !!r2.success;
      }
      if (r1.success && ok2) {
        console.log(`  [FIXED${opts.verify ? ' + VERIFIED x2' : ''}] ID=${tvtId} | ma=${info.ma}`);
      }
    } catch (e) {
      console.error(`  [ERROR] ID=${tvtId} | ma=${info.ma} | ${e.response?.status || ''} ${JSON.stringify(e.response?.data || e.message)}`);
    }
  }
}

async function main() {
  const opts = parseArgs(process.argv);
  if (!opts.station && !opts.all) {
    console.log('Vui lòng truyền --station <ma_tram> hoặc --all (thêm --dry-run để chỉ quét, --verify để kiểm thử lưu 2 lần).');
    process.exit(1);
  }
  const stations = db.getStations(true);
  const targets = opts.all
    ? stations
    : stations.filter(s => s.username.startsWith(opts.station));

  if (targets.length === 0) {
    console.error(`Không tìm thấy trạm nào khớp "${opts.station}"`);
    process.exit(1);
  }

  for (const st of targets) {
    try {
      await processStation(st, opts);
    } catch (e) {
      console.error(`[${st.username}] Lỗi xử lý trạm:`, e.message);
    }
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
