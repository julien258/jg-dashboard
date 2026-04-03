# ÉTAT DES DOSSIERS — GROUPE GUIRAUD
> Mis à jour le : 3 avril 2026  
> Fichier de référence — à lire en début de session Claude

---

## SOCIÉTÉS DU GROUPE

| Société | SIREN | Forme | Siège actuel | Statut |
|---|---|---|---|---|
| SAS LIVING | 983 940 958 | SAS | 2 rue d'Austerlitz, 31000 Toulouse | Active — Holding principale |
| SARL GUIRAUD JULIEN | 511 517 542 | SARL | 4 La Croix-Gandineau, 33126 Fronsac → **Paris en cours** | Transfert siège en cours |
| SARL DE FAMILLE LA MEULETTE | 917 705 394 | SARL famille | 4 La Croix-Gandineau, 33126 Fronsac → **Paris en cours** | Transfert siège en cours |
| SAS REAL GAINS (MONIKAZA) | 837 895 721 | SAS | 250 bis Bd St-Germain, 75007 Paris | Active — 100% SAS LIVING |
| SAS PANGEE | 802 644 518 | SAS | — | **Liquidation judiciaire** depuis 19/01/2026 |

**Associés SARL GUIRAUD :** LA MEULETTE 51% (36 parts) · Julien GUIRAUD 49% (34 parts)  
**Associés LA MEULETTE :** Julien GUIRAUD 90% (900 parts) · Candice GRAVIER 10% (100 parts)  
**Gérant partout :** Julien GUIRAUD  
**Domiciliation :** Euro Start Entreprises SAS — 250 bis Bd St-Germain, 75007 Paris

---

## DASHBOARD TECHNIQUE

**Repo GitHub :** julien258/jg-dashboard  
**Token GitHub :** ghp_***REDACTED*** (à récupérer dans GitHub → Settings → Developer settings → PAT) (jg-dashboard-deploy)  
**Netlify :** jg-groupe-dashboard.netlify.app (déploiement auto sur push main)  
**Supabase :** https://uqpgwypgkwlvrpxtxhia.supabase.co  

**Fichiers principaux :**
- `dashboard-groupe.html` — dashboard pro groupe
- `foyer-budget.html` — budget personnel Julien

**Commits du jour (3 avril 2026) :**
- c346f19 — fix foyer-budget : IR 2025 + rattrapage charges fixes mois courant
- 6034ab1 — fix dettes : boutons ✎✕ vue société + editDebt navigation
- 88a180c — feat charges : vue groupée + fiche contrat + alertes résiliation
- bc6a600 — fix charges : pré-sélectionner curCo dans formulaire
- 2a05ba9 — feat virements : refonte prélèvements à venir — alertes J-2
- 4120143 — fix virements : syntaxe JS apostrophe + backticks

---

## CHANTIERS EN COURS — À REPRENDRE APRÈS DÉJEUNER

### Dashboard — ce qui reste à faire

**Migration Supabase à faire (30 sec) :**
Aller sur https://supabase.com/dashboard/project/uqpgwypgkwlvrpxtxhia/sql/new et exécuter :
```sql
ALTER TABLE recurring_charges
  ADD COLUMN IF NOT EXISTS resiliation_notice_days integer DEFAULT 30,
  ADD COLUMN IF NOT EXISTS auto_renewal boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS contract_duration_months integer DEFAULT 12;
```

**Charges récurrentes :**
- Les charges créées depuis LIVING avant le fix bc6a600 sont sauvegardées sous sarl-guiraud
- À corriger dans Supabase Table Editor : recurring_charges → filtrer company_id incorrects

**Conventions de facturation (à reprendre) :**
- Rédiger convention management fees SARL GUIRAUD → SAS LIVING (à compter 01/04/2026)
- Montant : besoin perso net mensuel (variable) + charges pro SARL GUIRAUD fixes
- Lettre résiliation convention GUIRAUD → REAL GAINS/BEL (préavis 1 mois)
- Pas de convention de trésorerie LIVING ↔ GUIRAUD nécessaire (pas de lien capitalistique)

**Prochains chantiers dashboard potentiels :**
- Améliorer le calendrier des paiements (barres avec société + compte)
- Connecter le besoin perso (foyer-budget) au KPI facturation SARL GUIRAUD (dashboard pro)
- Vérifier les données Pennylane — comptes bien synchronisés

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
**Action restante :**
- [ ] Obtenir attestation Me Payen (pièce 4) avant le 1er juin

---

## 4. PANGEE — LIQUIDATION + CRÉANCE BPO

**Liquidateur :** Me Julien PAYEN  
**Audience BPO :** TC Toulouse — **14 avril 2026**

---

## 5. REAL GAINS vs ALEXANDRE SHIMON AICH (MONIKAZA)

**Action restante :**
- [ ] Qualification comptable des fonds avec expert-comptable avant envoi lettre réponse

---

## 6. HAAS AVOCATS — LITIGE HONORAIRES (BÂTONNIER)

**Référence :** 211 / 423486 — Montant contesté : 25 256,30€ TTC

---

## 7. SARL LA MEULETTE vs IZI BY EDF

**LRAR envoyée** (27/03/2026) — délai 15 jours — attente réponse

---

## 8. KOELA / COFIDIS — CRÉDIT AFFECTÉ

**Action restante :**
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
| ~8 avril 2026 | Commission VELOMOTION | LEASECOM — SAS LIVING |
| 7 avril 2026 | MEE 14h00 | Carrefour — TC Évry |
| 14 avril 2026 | Audience BPO | PANGEE — TC Toulouse |
| 1er juin 2026 | Audience 13h30 | FINANCO — TJ Montpellier |

---

## CONTACTS CLÉS

| Nom | Rôle | Contact |
|---|---|---|
| Me Sonia BEAUFILS | Avocate principale (RECCI) | sbeaufils@recci.fr — Toque C2207 |
| Me Jean-Armand MEGGLE | RECCI CONSEILS (KOELA) | — |
| Me Julien PAYEN | Liquidateur PANGEE | SELARL Julien Payen, Toulouse |
| Candice GRAVIER | Co-signataire, associée LA MEULETTE 10% | — |

---

*Ce fichier est la source unique de vérité sur l'état des dossiers. Mis à jour après chaque session.*
