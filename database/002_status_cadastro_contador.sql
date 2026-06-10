ALTER TABLE cadastro_contador
    ADD COLUMN IF NOT EXISTS status CHAR(1) NOT NULL DEFAULT 'T';

ALTER TABLE cadastro_contador
    DROP CONSTRAINT IF EXISTS chk_cadastro_contador_status;

ALTER TABLE cadastro_contador
    ADD CONSTRAINT chk_cadastro_contador_status
        CHECK (status IN ('T', 'F'));

CREATE INDEX IF NOT EXISTS idx_cadastro_contador_filial_ativos
    ON cadastro_contador (idfilial_usr, tipo_contador)
    WHERE status = 'T';
