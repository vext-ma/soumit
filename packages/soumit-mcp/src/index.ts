#!/usr/bin/env node

/**
 * @vext-ma/soumit-mcp
 *
 * Official Model Context Protocol (MCP) server for Soumit (https://soumit.ma).
 * Connects Claude Desktop, Cursor, Windsurf, Claude Code, and autonomous AI agents
 * directly to Moroccan Public Procurement Intelligence (Marchés Publics Maroc, Décret n° 2-22-431).
 */

import readline from "node:readline";

export const SOUMIT_API_URL = process.env.SOUMIT_API_URL || "https://soumit.ma";
export const SOUMIT_API_KEY = process.env.SOUMIT_API_KEY || "";

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export interface ComplianceResult {
  status: "CONFORME" | "OFFRE_ANORMALEMENT_BASSE" | "OFFRE_EXCESSIVE";
  statusText: string;
  estimatedAmountHt: number;
  proposedAmountHt: number;
  discountPct: number;
  floorAmount: number;
  ceilingAmount: number;
  maxLowDiscount: number;
  legalArticle: string;
  advisory: string;
}

/**
 * Computes Moroccan Procurement Decree 2-22-431 financial compliance:
 * - Article 44 & 45: Abnormally low offer (-20% travaux, -25% fournitures/services)
 * - Article 44: Excessive offer (+20% for all categories)
 */
export function computeDecreeCompliance(params: {
  estimatedAmountHt: number;
  proposedAmountHt: number;
  sectorType?: "travaux" | "fournitures" | "services" | string;
}): ComplianceResult {
  const est = Number(params.estimatedAmountHt);
  const prop = Number(params.proposedAmountHt);
  const sector = (params.sectorType || "fournitures").toLowerCase();

  const maxLowDiscount = sector === "travaux" ? 0.20 : 0.25;
  const floorAmount = est * (1 - maxLowDiscount);
  const ceilingAmount = est * 1.20;
  const discountPct = ((est - prop) / est) * 100;

  if (prop < floorAmount) {
    return {
      status: "OFFRE_ANORMALEMENT_BASSE",
      statusText: "RISQUE ÉLEVÉ : OFFRE ANORMALEMENT BASSE (Art. 44 & 45)",
      estimatedAmountHt: est,
      proposedAmountHt: prop,
      discountPct,
      floorAmount,
      ceilingAmount,
      maxLowDiscount,
      legalArticle: "Décret n° 2-22-431 Articles 44 & 45",
      advisory: `L'offre (${prop.toLocaleString("fr-FR")} MAD) est inférieure de ${discountPct.toFixed(1)}% à l'estimation administrative (seuil légal: -${(maxLowDiscount * 100).toFixed(0)}%). La commission d'appel d'offres réclamera des sous-détails de prix justificatifs sous peine d'élimination d'office.`,
    };
  }

  if (prop > ceilingAmount) {
    return {
      status: "OFFRE_EXCESSIVE",
      statusText: "REJET CERTAIN : OFFRE EXCESSIVE (Art. 44)",
      estimatedAmountHt: est,
      proposedAmountHt: prop,
      discountPct,
      floorAmount,
      ceilingAmount,
      maxLowDiscount,
      legalArticle: "Décret n° 2-22-431 Article 44",
      advisory: `L'offre dépasse l'estimation administrative de plus de 20% (+${(-discountPct).toFixed(1)}%). Elle sera écartée d'office comme excessive.`,
    };
  }

  return {
    status: "CONFORME",
    statusText: "CONFORME (ZONE COMPÉTITIVE OPTIMALE)",
    estimatedAmountHt: est,
    proposedAmountHt: prop,
    discountPct,
    floorAmount,
    ceilingAmount,
    maxLowDiscount,
    legalArticle: "Décret n° 2-22-431 Articles 44 & 45",
    advisory: `L'écart de ${discountPct >= 0 ? `-${discountPct.toFixed(1)}%` : `+${(-discountPct).toFixed(1)}%`} se situe dans le couloir légal de validité financière.`,
  };
}

export const TOOLS: ToolDefinition[] = [
  {
    name: "search_tenders",
    description: "Rechercher des appels d'offres publics marocains récents et actifs par mot-clé, région ou secteur.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Mots-clés de recherche (ex: 'scanner médical', 'fibre optique', 'travaux', 'gardiennage').",
        },
        sector: {
          type: "string",
          description: "Secteur d'activité (travaux, fournitures, services).",
        },
        min_amount: {
          type: "number",
          description: "Budget estimatif minimum en Dirhams (MAD).",
        },
        limit: {
          type: "number",
          description: "Nombre maximum de résultats (défaut: 10, max: 50).",
        },
      },
    },
  },
  {
    name: "get_tender_details",
    description: "Obtenir la fiche complète, la synthèse du DCE, les critères éliminatoires et le verdict Go/No-Go d'un appel d'offres.",
    inputSchema: {
      type: "object",
      properties: {
        tender_id: {
          type: "string",
          description: "Identifiant unique de l'appel d'offres ou référence du marché.",
        },
      },
      required: ["tender_id"],
    },
  },
  {
    name: "check_regulatory_compliance",
    description: "Calculer la conformité légale d'une offre financière avec le Décret n° 2-22-431 (détection d'offre anormalement basse ou excessive).",
    inputSchema: {
      type: "object",
      properties: {
        estimated_amount_ht: {
          type: "number",
          description: "Montant estimatif administratif du marché en Dirhams HT.",
        },
        proposed_amount_ht: {
          type: "number",
          description: "Montant de l'offre proposée en Dirhams HT.",
        },
        sector_type: {
          type: "string",
          enum: ["travaux", "fournitures", "services"],
          description: "Nature de la prestation pour appliquer le seuil légal (-20% travaux vs -25% fournitures/services).",
        },
      },
      required: ["estimated_amount_ht", "proposed_amount_ht"],
    },
  },
  {
    name: "search_competitor_awards",
    description: "Consulter l'historique d'attribution publique d'un concurrent ou attributaire au Maroc (PVs d'attribution, montants gagnés, rabais appliqués).",
    inputSchema: {
      type: "object",
      properties: {
        competitor_name: {
          type: "string",
          description: "Raison sociale ou nom du concurrent.",
        },
        limit: {
          type: "number",
          description: "Nombre maximum d'attributions à renvoyer (défaut: 15).",
        },
      },
      required: ["competitor_name"],
    },
  },
  {
    name: "get_market_barometer",
    description: "Consulter le baromètre hebdomadaire du marché de la commande publique marocaine (volumes globaux, secteurs prédominants, taux de rabais moyens).",
    inputSchema: {
      type: "object",
      properties: {
        period: {
          type: "string",
          enum: ["current", "quarterly"],
          description: "Période du baromètre ('current' pour l'hebdomadaire, 'quarterly' pour le trimestre).",
        },
      },
    },
  },
  {
    name: "audit_submission_checklist",
    description: "Vérifier la conformité du dossier de candidature administratif (caution provisoire, déclaration sur l'honneur, visite des lieux) sous les Articles 27 & 28 du Décret 2-22-431.",
    inputSchema: {
      type: "object",
      properties: {
        tender_reference: {
          type: "string",
          description: "Référence de l'appel d'offres.",
        },
        has_provisional_guarantee: {
          type: "boolean",
          description: "Le récépissé ou cautionnement provisoire original est-il préparé ?",
        },
        has_declaration_on_honor: {
          type: "boolean",
          description: "La déclaration sur l'honneur est-elle conforme au modèle Décret 2-22-431 Article 27 ?",
        },
        has_site_visit_certificate: {
          type: "boolean",
          description: "Le certificat de visite des lieux a-t-il été obtenu (si requis par le RC) ?",
        },
      },
      required: ["tender_reference"],
    },
  },
];

async function callSoumitApi(path: string, options: RequestInit = {}): Promise<any> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
    "User-Agent": "@vext-ma/soumit-mcp/1.1.0",
    ...((options.headers as Record<string, string>) || {}),
  };

  if (SOUMIT_API_KEY) {
    headers["Authorization"] = `Bearer ${SOUMIT_API_KEY}`;
  }

  const url = `${SOUMIT_API_URL.replace(/\/$/, "")}${path}`;
  const res = await fetch(url, { ...options, headers });
  if (!res.ok) {
    const errorText = await res.text().catch(() => "Unknown error");
    throw new Error(`Soumit API error ${res.status}: ${errorText}`);
  }
  return res.json();
}

export async function handleToolCall(name: string, args: Record<string, any>): Promise<{ content: Array<{ type: string; text: string }> }> {
  switch (name) {
    case "search_tenders": {
      const q = encodeURIComponent(args.query || "");
      const sector = encodeURIComponent(args.sector || "");
      const limit = args.limit || 10;
      try {
        const data = await callSoumitApi(`/api/v1/tenders?q=${q}&sector=${sector}&limit=${limit}`);
        const tenders = data?.data || data?.tenders || [];
        if (!tenders.length) {
          return {
            content: [{
              type: "text",
              text: `Aucun appel d'offres trouvé pour la requête '${args.query || ""}'.`,
            }],
          };
        }

        const lines = tenders.map((t: any, idx: number) => {
          const amount = t.budget?.amount ? `${Number(t.budget.amount).toLocaleString("fr-FR")} ${t.budget.currency || "MAD"}` : "Non spécifié";
          const deadline = t.deadline || "N/A";
          return `${idx + 1}. [${t.id}] ${t.title}\n   - Acheteur: ${t.buyer?.name || "N/A"}\n   - Estimation: ${amount} | Échéance: ${deadline}\n   - Région: ${t.region || "Toutes"} | Détails: ${SOUMIT_API_URL}/tenders/${t.id}`;
        });

        return {
          content: [{
            type: "text",
            text: `🎯 **${tenders.length} Appel(s) d'Offres Actif(s) (Soumit Intelligence Engine)** :\n\n${lines.join("\n\n")}`,
          }],
        };
      } catch (err: any) {
        return {
          content: [{ type: "text", text: `Erreur lors de la recherche des appels d'offres : ${err.message}` }],
        };
      }
    }

    case "get_tender_details": {
      const tenderId = encodeURIComponent(args.tender_id);
      try {
        const t = await callSoumitApi(`/api/v1/tenders/${tenderId}`);
        const amount = t.budget?.amount ? `${Number(t.budget.amount).toLocaleString("fr-FR")} ${t.budget.currency || "MAD"}` : "Non spécifié";

        const text = `📋 **Fiche Appel d'Offres : ${t.id}**
- **Objet** : ${t.title}
- **Acheteur public** : ${t.buyer?.name || "N/A"}
- **Budget estimatif** : ${amount}
- **Date limite de soumission** : ${t.deadline || "N/A"}
- **Région** : ${t.region || "National"}
- **Procédure** : ${t.procedure_type || "Ouverte"}
- **Lien dossier** : ${SOUMIT_API_URL}/tenders/${t.id}`;

        return { content: [{ type: "text", text }] };
      } catch (err: any) {
        return { content: [{ type: "text", text: `Erreur lors de la récupération : ${err.message}` }] };
      }
    }

    case "check_regulatory_compliance": {
      const comp = computeDecreeCompliance({
        estimatedAmountHt: args.estimated_amount_ht,
        proposedAmountHt: args.proposed_amount_ht,
        sectorType: args.sector_type,
      });

      const text = `⚖️ **Analyse de Conformité Réglementaire (${comp.legalArticle})** :
- **Estimation de l'Administration** : ${comp.estimatedAmountHt.toLocaleString("fr-FR")} MAD HT
- **Montant Proposé par l'Entreprise** : ${comp.proposedAmountHt.toLocaleString("fr-FR")} MAD HT
- **Taux de rabais constaté** : ${comp.discountPct >= 0 ? `-${comp.discountPct.toFixed(1)}%` : `+${(-comp.discountPct).toFixed(1)}%`}
- **Seuil d'Offre Anormalement Basse** : ${comp.floorAmount.toLocaleString("fr-FR")} MAD HT (-${(comp.maxLowDiscount * 100).toFixed(0)}%)
- **Plafond d'Offre Excessive** : ${comp.ceilingAmount.toLocaleString("fr-FR")} MAD HT (+20%)

📊 **Verdict Réglementaire** : **${comp.statusText}**
💡 **Conseil Stratégique** : ${comp.advisory}`;

      return { content: [{ type: "text", text }] };
    }

    case "search_competitor_awards": {
      try {
        const data = await callSoumitApi(`/api/v1/awards?limit=${args.limit || 15}`);
        const awards = (data?.data || []).filter((a: any) =>
          !args.competitor_name ||
          (a.awardee?.name && a.awardee.name.toLowerCase().includes(args.competitor_name.toLowerCase()))
        );

        if (!awards.length) {
          return {
            content: [{
              type: "text",
              text: `Aucune attribution publique trouvée pour le concurrent '${args.competitor_name}'.`,
            }],
          };
        }

        const lines = awards.map((a: any, idx: number) => {
          const amt = a.awarded_amount ? `${Number(a.awarded_amount).toLocaleString("fr-FR")} ${a.currency || "MAD"}` : "Non communiqué";
          return `${idx + 1}. Attributaire : **${a.awardee?.name}** | Montant : ${amt}\n   - Acheteur : ${a.buyer?.name || "N/A"}\n   - Date : ${a.award_date || "N/A"} | Éviction : ${a.is_unsuccessful ? "Marché infructueux" : "Attribution confirmée"}`;
        });

        return {
          content: [{
            type: "text",
            text: `🏢 **Attributions Publiques Enregistrées (${awards.length})** :\n\n${lines.join("\n\n")}`,
          }],
        };
      } catch (err: any) {
        return { content: [{ type: "text", text: `Erreur consultation attributions : ${err.message}` }] };
      }
    }

    case "get_market_barometer": {
      try {
        const isQuarterly = args.period === "quarterly";
        const path = isQuarterly ? "/api/v1/barometer/quarterly" : "/api/v1/barometer";
        const b = await callSoumitApi(path);

        const sectorsText = (b.sectors || [])
          .map((s: any) => `  • **${s.name}** : ${s.count} marchés (${Number(s.volume).toLocaleString("fr-FR")} MAD — ${s.share_pct}%)`)
          .join("\n");

        const text = `📈 **Baromètre de la Commande Publique Marocaine (Édition ${b.edition_date || "Actuelle"})** :
- **Nombre total de nouveaux appels d'offres** : ${b.total_new_tenders || 0}
- **Volume budgétaire engagé** : ${b.total_budget_mad ? Number(b.total_budget_mad).toLocaleString("fr-FR") : "0"} MAD
- **Budget moyen par consultation** : ${b.average_budget_mad ? Number(b.average_budget_mad).toLocaleString("fr-FR") : "0"} MAD
- **Taux de rabais médian national** : ${b.median_discount_pct !== null && b.median_discount_pct !== undefined ? `${b.median_discount_pct}%` : "Non calculé"}

🏭 **Répartition par Secteurs Clés** :
${sectorsText || "  Données sectorielles en cours de consolidation"}

💡 **Éclairage Réglementaire** :
${b.regulatory_insight?.title ? `**${b.regulatory_insight.title}** (${b.regulatory_insight.legal_ref})\n${b.regulatory_insight.takeaway}` : "Suivi continu des décrets et circulaires de la TGR."}`;

        return { content: [{ type: "text", text }] };
      } catch (err: any) {
        return { content: [{ type: "text", text: `Erreur baromètre : ${err.message}` }] };
      }
    }

    case "audit_submission_checklist": {
      const ref = args.tender_reference;
      const hasProv = Boolean(args.has_provisional_guarantee);
      const hasDecl = Boolean(args.has_declaration_on_honor);
      const hasVisit = Boolean(args.has_site_visit_certificate);

      const items: string[] = [
        `- **Cautionnement provisoire (Art. 23 & 27)** : ${hasProv ? "✅ Présent" : "❌ MANQUANT (Cause d'élimination automatique à l'ouverture des plis)"}`,
        `- **Déclaration sur l'honneur conforme (Art. 27)** : ${hasDecl ? "✅ Conforme" : "❌ MANQUANTE OU NON CONFORME (Obligatoire sous le modèle type Décret 2-22-431)"}`,
        `- **Certificat de visite des lieux** : ${hasVisit ? "✅ Obtenu et validé" : "⚠️ À vérifier si imposé par le Règlement de Consultation (RC)"}`,
      ];

      const pass = hasProv && hasDecl;
      const text = `📋 **Audit du Dossier Administratif de Candidature — Réf : ${ref}**
${items.join("\n")}

🚦 **Statut du Dossier** : **${pass ? "DOSSIER RECEVABLE" : "RISQUE CRITIQUE D'ÉLIMINATION"}**
💡 **Règle d'Or Marchés Publics** : L'omission du cautionnement provisoire ou de la déclaration sur l'honneur entraîne le rejet irrévocable de l'offre sans ouverture de l'offre technique ou financière.`;

      return { content: [{ type: "text", text }] };
    }

    default:
      throw new Error(`Outil inconnu : ${name}`);
  }
}

// --- JSON-RPC Stdio Server --------------------------------------------------

function sendResponse(id: any, result: any, error?: any): void {
  const payload: Record<string, any> = { jsonrpc: "2.0", id };
  if (error) {
    payload.error = error;
  } else {
    payload.result = result;
  }
  process.stdout.write(JSON.stringify(payload) + "\n");
}

export function startMcpServer(): void {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false,
  });

  rl.on("line", async (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    try {
      const request = JSON.parse(trimmed);
      const { id, method, params } = request;

      if (method === "initialize") {
        sendResponse(id, {
          protocolVersion: "2024-11-05",
          capabilities: {
            tools: {},
            prompts: {},
          },
          serverInfo: {
            name: "soumit-intelligence-engine",
            version: "1.1.0",
          },
        });
      } else if (method === "tools/list") {
        sendResponse(id, { tools: TOOLS });
      } else if (method === "tools/call") {
        const toolName = params?.name;
        const toolArgs = params?.arguments || {};
        try {
          const result = await handleToolCall(toolName, toolArgs);
          sendResponse(id, result);
        } catch (err: any) {
          sendResponse(id, null, {
            code: -32000,
            message: err.message || "Erreur d'exécution de l'outil",
          });
        }
      } else if (method === "ping") {
        sendResponse(id, {});
      } else {
        sendResponse(id, null, {
          code: -32601,
          message: `Méthode non supportée : ${method}`,
        });
      }
    } catch {
      sendResponse(null, null, {
        code: -32700,
        message: "JSON Parse error",
      });
    }
  });

  process.stderr.write("🚀 Soumit MCP Server démarré avec succès sur stdio.\n");
}

// Auto-start when invoked directly via CLI
if (import.meta.url === `file://${process.argv[1]}`) {
  startMcpServer();
}
