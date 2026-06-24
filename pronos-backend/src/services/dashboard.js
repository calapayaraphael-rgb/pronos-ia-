import { query } from "../db.js";
import { config } from "../config.js";

function maxDrawdown(curve) {
  let peak = -Infinity, mdd = 0;
  for (const pt of curve) { peak = Math.max(peak, pt.bankroll); mdd = Math.min(mdd, pt.bankroll - peak); }
  return +Math.abs(mdd).toFixed(2);
}

export async function buildDashboard(userId) {
  const u = userId ? "AND b.user_id=$1" : "";
  const args = userId ? [userId] : [];

  const global = (await query(
    `SELECT count(*) FILTER (WHERE status IN ('gagné','perdu')) n,
            count(*) FILTER (WHERE status='gagné') wins,
            COALESCE(sum(stake) FILTER (WHERE status IN ('gagné','perdu')),0) staked,
            COALESCE(sum(profit),0) profit,
            count(*) FILTER (WHERE status='en_attente') pending,
            count(*) total
     FROM bets b WHERE 1=1 ${u}`, args)).rows[0];
  const staked = Number(global.staked), profit = Number(global.profit), n = Number(global.n);
  const roi = staked ? profit / staked : 0;

  const bySport = (await query(
    `SELECT s.group_name AS k, count(*) n, count(*) FILTER (WHERE b.status='gagné') wins,
            COALESCE(sum(b.profit),0) profit, COALESCE(sum(b.stake),0) staked
     FROM bets b JOIN matches m ON m.id=b.match_id JOIN sports s ON s.key=m.sport_key
     WHERE b.status IN ('gagné','perdu') ${u} GROUP BY s.group_name ORDER BY 4 DESC`, args)).rows;

  const byLeague = (await query(
    `SELECT m.league AS k, count(*) n, count(*) FILTER (WHERE b.status='gagné') wins,
            COALESCE(sum(b.profit),0) profit, COALESCE(sum(b.stake),0) staked
     FROM bets b JOIN matches m ON m.id=b.match_id
     WHERE b.status IN ('gagné','perdu') ${u} GROUP BY m.league ORDER BY 4 DESC`, args)).rows;

  const byMarket = (await query(
    `SELECT b.market AS k, count(*) n, count(*) FILTER (WHERE b.status='gagné') wins,
            COALESCE(sum(b.profit),0) profit, COALESCE(sum(b.stake),0) staked
     FROM bets b WHERE b.status IN ('gagné','perdu') ${u} GROUP BY b.market ORDER BY 4 DESC`, args)).rows;

  // courbe bankroll
  const settled = (await query(
    `SELECT settled_at, profit FROM bets b WHERE status IN ('gagné','perdu') ${u} ORDER BY settled_at ASC`, args)).rows;
  let bk = config.START_BANKROLL;
  const curve = [{ at: null, bankroll: bk }];
  for (const r of settled) { bk += Number(r.profit); curve.push({ at: r.settled_at, bankroll: +bk.toFixed(2) }); }

  // CLV moyen : sur le modele (predictions ayant atteint la cloture) + sur les paris
  const clvModel = (await query(`SELECT avg(clv_pct) a, count(*) n FROM predictions WHERE clv_pct IS NOT NULL`)).rows[0];
  const clvBets = (await query(`SELECT avg(clv_pct) a, count(*) n FROM bets b WHERE clv_pct IS NOT NULL ${u}`, args)).rows[0];

  const monthly = (await query(
    `SELECT to_char(date_trunc('month', settled_at),'YYYY-MM') AS period,
            count(*) n, COALESCE(sum(profit),0) profit, COALESCE(sum(stake),0) staked
     FROM bets b WHERE status IN ('gagné','perdu') ${u} GROUP BY 1 ORDER BY 1`, args)).rows;
  const yearly = (await query(
    `SELECT to_char(date_trunc('year', settled_at),'YYYY') AS period,
            count(*) n, COALESCE(sum(profit),0) profit, COALESCE(sum(stake),0) staked
     FROM bets b WHERE status IN ('gagné','perdu') ${u} GROUP BY 1 ORDER BY 1`, args)).rows;

  const fmt = (r) => ({ key: r.k || "—", n: Number(r.n), hit: r.n > 0 ? Number(r.wins) / Number(r.n) : 0, profit: Number(r.profit), roi: Number(r.staked) > 0 ? Number(r.profit) / Number(r.staked) : 0 });
  const fmtP = (r) => ({ period: r.period, n: Number(r.n), profit: Number(r.profit), roi: Number(r.staked) > 0 ? Number(r.profit) / Number(r.staked) : 0 });

  return {
    global: { bets: Number(global.total), settled: n, pending: Number(global.pending), wins: Number(global.wins), hitRate: n ? Number(global.wins) / n : 0, staked, profit, roi },
    clv: {
      model: { avgPct: clvModel.a != null ? Number(clvModel.a) : null, n: Number(clvModel.n) },
      bets: { avgPct: clvBets.a != null ? Number(clvBets.a) : null, n: Number(clvBets.n) },
      note: "Le CLV est l'indicateur principal : un CLV moyen positif sur un echantillon suffisant indique un modele de qualite, independamment du ROI a court terme.",
    },
    bySport: bySport.map(fmt), byLeague: byLeague.map(fmt), byMarket: byMarket.map(fmt),
    bankrollCurve: curve, maxDrawdown: maxDrawdown(curve), startBankroll: config.START_BANKROLL,
    monthly: monthly.map(fmtP), yearly: yearly.map(fmtP),
  };
}
