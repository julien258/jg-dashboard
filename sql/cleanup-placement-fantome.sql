-- Nettoyage : supprimer le placement fantôme 200k€ Meulette
-- Validé avec Julien le 22 avril 2026 : pas de vrai placement Meulette, c'est une ligne de test obsolète
-- Source de vérité future : table contracts (stratégie A)

DELETE FROM placements WHERE id = '08b26958-38e0-4360-b56d-ff37e4ed3fc3';

-- Vérification
SELECT COUNT(*) AS placements_restants FROM placements;
