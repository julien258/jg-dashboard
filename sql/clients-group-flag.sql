-- ============================================================================
-- Migration clients : identification groupe/externe + nettoyage FCR
-- Exécuter dans Supabase SQL Editor
-- Validé avec Julien le 22 avril 2026
-- ============================================================================

-- 1. Ajouter la colonne is_group_entity (par défaut FALSE = externe)
ALTER TABLE clients ADD COLUMN IF NOT EXISTS is_group_entity BOOLEAN DEFAULT FALSE;

-- 2. Flaguer les 5 sociétés internes du groupe
-- Dubai New Holdco = ancien nom d'Alpha (AlphaTMax Dubai OPCO) — maintenant active
UPDATE clients SET is_group_entity = TRUE WHERE id = 'b7b9d83b-18b9-473d-8d17-8e4e5fb37e14'; -- Dubai New Holdco → Alpha
UPDATE clients SET is_group_entity = TRUE WHERE id = '79565ac4-42dc-466f-883d-bf1a1c0c7878'; -- La Meulette
UPDATE clients SET is_group_entity = TRUE WHERE id = 'f9bed63e-a4bf-40ee-b07e-0e3c5fa01ac1'; -- RG / Monikaza
UPDATE clients SET is_group_entity = TRUE WHERE id = '01e706a2-a1a5-4e85-a0c2-cd2e6ad4b0ff'; -- SARL Guiraud Julien
UPDATE clients SET is_group_entity = TRUE WHERE id = '78810758-8e8b-4da2-9dcd-b0a6e4c2c9ca'; -- SAS Living

-- ⚠ IDs complets à adapter selon Supabase — voir la table clients pour les IDs corrects
-- Les 8 premiers caractères visibles dans le debug : b7b9d83b, 79565ac4, f9bed63e, 01e706a2, 78810758
-- Si les UPDATE ne matchent rien, il faut récupérer les UUID complets depuis l'écran debug

-- 3. Fusionner les contrats de "FCR Original" (f0f53954) vers "FCR" (2383c68e)
-- Puis supprimer le doublon FCR Original
UPDATE contracts SET client_id = '2383c68e-XXXX'
  WHERE client_id = 'f0f53954-XXXX';
-- DELETE FROM clients WHERE id = 'f0f53954-XXXX';
-- ⚠ Décommenter après vérification manuelle qu'aucun contrat ne référence encore FCR Original

-- 4. Vérifier le résultat
SELECT id, name, is_group_entity, notes FROM clients ORDER BY is_group_entity DESC, name;
