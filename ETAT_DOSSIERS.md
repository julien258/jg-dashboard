# ÉTAT DES DOSSIERS — GROUPE GUIRAUD
> Mis à jour le : 6 avril 2026  
> Fichier de référence — à lire en début de session Claude

---

## SOCIÉTÉS DU GROUPE

| Société | SIREN | Forme | Siège actuel | Statut |
|---|---|---|---|---|
| SAS LIVING | 983 940 958 | SAS | 2 rue d'Austerlitz, 31000 Toulouse | Active — Holding opérationnelle principale |
| SARL GUIRAUD JULIEN | 511 517 542 | SARL | 4 La Croix-Gandineau, 33126 Fronsac → **Paris en cours** | Transfert siège en cours |
| SARL DE FAMILLE LA MEULETTE | 917 705 394 | SARL famille | 4 La Croix-Gandineau, 33126 Fronsac → **Paris en cours** | Transfert siège en cours |
| SAS REAL GAINS (MONIKAZA) | 837 895 721 | SAS | 250 bis Bd St-Germain, 75007 Paris | Active — 100% SAS LIVING |
| SAS PANGEE | 802 644 518 | SAS | — | **Liquidation judiciaire** depuis 19/01/2026 |

**Associés SARL GUIRAUD :** LA MEULETTE 51% (36 parts) · Julien GUIRAUD 49% (34 parts)  
**Associés LA MEULETTE :** Julien GUIRAUD 90% (900 parts) · Candice GRAVIER 10% (100 parts)  
**Gérant partout :** Julien GUIRAUD  
**Domiciliation :** Euro Start Entreprises SAS — 250 bis Bd St-Germain, 75007 Paris

---

## DASHBOARD TECHNIQUE — ÉTAT AU 6 AVRIL 2026

**Repo GitHub :** julien258/jg-dashboard  
**PAT GitHub :** [TOKEN — récupérer dans GitHub → Settings → Developer settings → PAT → "jg-dashboard-deploy"] (expire mai 2026)  
**Config git début de session :** `git remote set-url origin https://[TOKEN]@github.com/julien258/jg-dashboard.git`  
**Netlify :** jg-groupe-dashboard.netlify.app (déploiement auto sur push main)  
**Supabase :** https://uqpgwypgkwlvrpxtxhia.supabase.co (Pro — pas de pause auto)  

**Fichiers principaux :**
- `dashboard-groupe.html` — dashboard pro groupe (~11 500 lignes)
- `foyer-budget.html` — budget personnel Julien

**⚠️ RÈGLE NETLIFY.TOML :** Dans `[functions]`, mettre UNIQUEMENT `node_bundler = "esbuild"`. Le champ `timeout` est invalide et casse tous les builds.

### Fonctions Netlify actives
| Fonction | Endpoint | Rôle |
|---|---|---|
| qonto-sync | /api/qonto-sync | Soldes + balances 5 comptes |
| qonto-transactions | /api/qonto-transactions | Transactions par société (nouveau) |
| qonto-bank-sync | /api/qonto-bank-sync | Sync Qonto+Wise → Supabase |
| pennylane-sync | /api/pennylane-sync | Soldes + impayés Pennylane |
| pennylane-factures | /api/pennylane-factures | Factures émises par mois |
| pennylane-transactions | /api/pennylane-transactions | Transactions Pennylane |
| cloture-mensuelle | /api/cloture-mensuelle | Checklist clôture + relevés |
| wise-sync | /api/wise-sync | Soldes Wise |
| ged-upload | /api/ged-upload | Upload GED → Google Drive |
| gmail-sync | /api/gmail-sync | Sync emails |
| qonto-debug | /api/qonto-debug | Debug env vars Qonto |
| pennylane-debug | /api/pennylane-debug | Debug Pennylane |

### Connexions API configurées (Netlify env vars)
**Qonto — 5 comptes :**
- QONTO_GUIRAUD = guiraud-julien-4008:[secret]
- QONTO_LIVING = sas-living-8663:[secret]
- QONTO_MEULETTE = sarl-de-famille-la-meulette-5112:[secret]
- QONTO_REAL_GAINS = back-end-logistics-7045:[secret]
- QONTO_MONIKAZA = monikaza-spv-9764:[secret]

**Wise — 3 tokens (partagés entre profils) :**
- WISE_API_TOKEN = 01a5f38b-d492-4ed3-ad13-16bb10e87df8 (perso + Real Gains)
- WISE_LIVING_TOKEN = 22414fbf-995f-48d0-bf2c-9b54acbccbd2
- WISE_MEULETTE_TOKEN = d93c28f7-c10b-4e4b-9fb3-44912b0106ce

**Pennylane :** PENNYLANE_LIVING_TOKEN · PENNYLANE_SARL_TOKEN · PENNYLANE_MEULETTE_TOKEN · PENNYLANE_REALGAINS_TOKEN  
**Supabase :** SUPABASE_URL · SUPABASE_SERVICE_KEY  
**Google :** GOOGLE_CLIENT_ID · GOOGLE_CLIENT_SECRET · GOOGLE_REFRESH_TOKEN  
**Autres :** ANTHROPIC_API_KEY · PAPPERS_API_KEY · YOUSIGN_API_KEY

### Modules dashboard construits
- **Vue groupe** : KPIs consolidés, widget Qonto temps réel (5 comptes), CC inter-sociétés
- **Clôture mensuelle** : 4 onglets — Relevés / Factures reçues / Factures émises / Documents & Transmission
- **Sync bancaire auto** : Qonto + Wise → bank_accounts_pro (upsert + suppression comptes clôturés)
- **Facturation intra-groupe** : Management fees GUIRAUD→LIVING (60k€ HT/mois via Pennylane)
- **Module TVA** : Schéma flux groupe + tableau B par société
- **Apurement dettes** : Tableau 3 mois glissants avec filtres fournisseur/priorité

### Supabase — tables principales
bank_accounts_pro (colonnes source + external_ref ajoutées), management_fees_invoices, recurring_charges (colonne tva_deductible ajoutée), ged_documents, debts, payables, receivables, cash_forecast, interco_balances, contracts, todos, settings

---

## CONVENTION MANAGEMENT FEES — SIGNÉE

- **Convention** : GUIRAUD JULIEN → SAS LIVING, antidatée 15 janvier 2026
- **Montant** : 60 000 € HT/mois (72 000 € TTC, TVA 20%)
- **Factures** jan-avr 2026 émises manuellement dans Pennylane SARL GUIRAUD (client : LIVING)
- **Document** : convention-mf-guiraud-living-2026-complete.docx (dans GED)
- **À partir de mai 2026** : bouton dashboard → facture automatique via API Pennylane

---

## TODO DASHBOARD — PROCHAINS CHANTIERS

### Priorité haute
- [ ] **Envoyer mail cabinet 451-F** avec preuve de paiement → demander accès API iSuite Expert (dépôt uniquement)
- [ ] **OAuth Qonto** : configurer pour initier des virements via API (nécessite portail développeur Qonto)
- [ ] **Ouvrir compte Wise SARL GUIRAUD** (manquant — Wise perso + Living + Meulette OK)
- [ ] **Virements Wise** : configurer RSA private key pour SCA token paiements

### Priorité moyenne
- [ ] **Module fiscal** : ~20 fonctions JS à implémenter. HTML OK, tables Supabase prêtes. Seuils : LUX 30j min · Dubai alerte 90j (Golden Visa 2027). Voir conversation 04/04/2026
- [ ] **Data room groupe** : Netlify semi-publique + NDA signé → comptable/CAC/avocat
- [ ] **Data room client** : par dossier (ex: VELOMOTION) accessible bailleurs/partenaires
- [ ] **Clôture factures reçues** : dédupliquer impayés multi-tentatives (ex: VW Bank Real Gains leasing)
- [ ] **Onglet "Factures intra-groupe"** : renommer depuis "Fact. GUIRAUD→LIVING" + ajouter loyers Meulette

### Priorité basse
- [ ] Connexion Calendly quand activité monte
- [ ] Module CCA inter-sociétés (encours réel −288 000 € théorique)
- [ ] Vue Apurement dettes refonte (urgences impôts/URSSAF/fournisseurs)

---

## 1. TRANSFERT DE SIÈGE — SARL GUIRAUD + LA MEULETTE

**Statut :** Documents produits — en attente budget JAL

**Actions restantes :**
- [ ] Signer PV + statuts (Julien + Candice pour LA MEULETTE)
- [ ] Publier JAL Gironde + Paris (x2 sociétés) + Haute-Garonne étab. sec. (x2) — budget ~1 500€
- [ ] Dépôt sur formalites.entreprises.gouv.fr après attestations JAL
- [ ] Avenant Euro Start : corriger "JULIEN GUIRAUD EURL" → "SARL GUIRAUD"
- [ ] Déclaration bénéficiaires effectifs mise à jour

---

## 2. REAL GAINS vs CARREFOUR HYPERMARCHÉS

**Juridiction :** Tribunal de Commerce d'Évry — NREF 20252161  
**Montant réclamé :** 495 682,02 € TTC  
**Avocat :** Me Sonia BEAUFILS — Cabinet RECCI (sbeaufils@recci.fr)  
**Prochaine échéance :** MEE **7 avril 2026 à 14h00**

---

## 3. FINANCO / ARKÉA — VÉHICULE ASTON MARTIN

**Audience :** **1er juin 2026 à 13h30** — TJ Montpellier  
- [ ] Obtenir attestation Me Payen (pièce 4) avant le 1er juin

---

## 4. PANGEE — LIQUIDATION + CRÉANCE BPO

**Liquidateur :** Me Julien PAYEN  
**Audience BPO :** TC Toulouse — **14 avril 2026**

---

## 5. REAL GAINS vs ALEXANDRE SHIMON AICH (MONIKAZA)

- [ ] Qualification comptable des fonds avec expert-comptable avant envoi lettre réponse

---

## 6. HAAS AVOCATS — LITIGE HONORAIRES (BÂTONNIER)

**Référence :** 211 / 423486 — Montant contesté : 25 256,30€ TTC

---

## 7. SARL LA MEULETTE vs IZI BY EDF

**LRAR envoyée** (27/03/2026) — délai 15 jours — attente réponse

---

## 8. KOELA / COFIDIS — CRÉDIT AFFECTÉ

- [ ] Lettre contestation à valider par Me MEGGLE avant envoi

---

## 9. URSSAF / TGGV — SAISIE-ATTRIBUTION

**PV saisie-attribution :** Exécuté 18 mars 2026  
**Statut :** Consultation avocat en cours

---

## 10. CGW / MANHATTAN PRIVATE CREDIT MARKETS

**Rupture :** Manhattan a mis fin à sa relation distributeur avec CGW (26 mars 2026)  
**Clause non-circumvention :** jusqu'à février 2027 — droit anglais

---

## 11. ENGIE — LITIGE FACTURATION

**LRAR envoyée** — attente réponse

---

## 12. QUERCIS PHARMA — CESSION DE PARTS

**Montant :** 5 000 000€ — NDA signé 23/03/2026 — suite à définir

---

## VELOMOTION / LEASECOM

**Commission attendue :** ~8 avril 2026 — Facturée par SAS LIVING

---

## AGENDA IMMÉDIAT

| Date | Échéance | Dossier |
|---|---|---|
| 7 avril 2026 | MEE 14h00 | Carrefour — TC Évry |
| 8 avril 2026 | Commission VELOMOTION | LEASECOM — SAS LIVING |
| 14 avril 2026 | Audience BPO | PANGEE — TC Toulouse |
| Avant 30/04 | Réponse bureau imposition Luxembourg | SCPCP |
| 1er juin 2026 | Audience 13h30 | FINANCO — TJ Montpellier |

---

## CONTACTS CLÉS

| Nom | Rôle | Contact |
|---|---|---|
| Me Sonia BEAUFILS | Avocate principale (RECCI) | sbeaufils@recci.fr — Toque C2207 |
| Me Jean-Armand MEGGLE | RECCI CONSEILS (KOELA) | — |
| Me Julien PAYEN | Liquidateur PANGEE | SELARL Julien Payen, Toulouse |
| Candice GRAVIER | Co-signataire, associée LA MEULETTE 10% | — |
| Cabinet 451-F | Expert-comptable | tools.451-f.com (iSuite Expert) |

---

## CABINET COMPTABLE — 451-F / iSUITE EXPERT

- **URL Swagger API :** https://tools.451-f.com/cnx/iSuiteExpert/api/swagger/
- **Statut :** En attente mail de demande d'accès API (dépôt de pièces uniquement dans un premier temps)
- **Action :** Envoyer mail avec preuve de paiement pour débloquer la relation + demander token API

---

## PROJET DUBAI / LUXEMBOURG — FISCAL

- **Objectif 2027 :** Délocalisation fiscale Dubai (Golden Visa 10 ans)
- **Seuils dashboard :** Luxembourg 30j min de présence · Dubai alerte à 90j
- **Immobilier Dubai :** Achat visé AED 2M+ (condition Golden Visa)
- **Module fiscal dashboard :** HTML fait, JS à implémenter (~20 fonctions)

---

## PROMPT DE LANCEMENT — COPIER EN DÉBUT DE SESSION

```
Bonjour. Je suis Julien GUIRAUD, président de SAS LIVING (Toulouse).
Lis le fichier ETAT_DOSSIERS.md dans mon Google Drive ou sur le repo 
GitHub julien258/jg-dashboard (branche main) pour récupérer tout le 
contexte avant de répondre.

--- ACCÈS & OUTILS DISPONIBLES ---

GITHUB :
- Repo : github.com/julien258/jg-dashboard
- Token PAT : [TOKEN — récupérer dans GitHub → Settings → Developer settings → PAT → "jg-dashboard-deploy"] (expire mai 2026)
- Config : git remote set-url origin https://[TOKEN]@github.com/julien258/jg-dashboard.git

NETLIFY :
- URL prod : https://jg-groupe-dashboard.netlify.app
- Déploiement automatique sur push main
- ⚠️ netlify.toml : dans [functions], UNIQUEMENT node_bundler="esbuild" — pas de timeout (invalide)

SUPABASE :
- URL : https://uqpgwypgkwlvrpxtxhia.supabase.co
- SQL Editor : supabase.com/dashboard/project/uqpgwypgkwlvrpxtxhia/sql/new

CONNEXIONS API (toutes dans Netlify env vars) :
- Qonto : 5 comptes (GUIRAUD/LIVING/MEULETTE/REAL_GAINS/MONIKAZA)
- Wise : 3 tokens (WISE_API_TOKEN perso+RG / WISE_LIVING_TOKEN / WISE_MEULETTE_TOKEN)
- Pennylane : 4 sociétés
- iSuite Expert 451-F : en attente accès API

GMAIL CONNECTÉ : jguiraudeurl@gmail.com (via MCP Gmail)

--- RÈGLES DE TRAVAIL ---

1. Toujours lire ETAT_DOSSIERS.md avant toute action
2. Résumer la demande AVANT de coder
3. Commits GitHub : toujours faire commit + push directement
4. Ne jamais inclure de tokens/secrets dans les fichiers committés
5. Fichiers principaux : dashboard-groupe.html · foyer-budget.html
6. Travailler sur les fichiers du repo cloné, pas les uploads
7. netlify.toml : pas de timeout dans [functions] — invalide et casse les builds
```

*Mis à jour le 6 avril 2026*
