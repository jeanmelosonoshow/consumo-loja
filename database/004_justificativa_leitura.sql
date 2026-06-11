ALTER TABLE leitura_contador
    ADD COLUMN IF NOT EXISTS motivo VARCHAR(120);

ALTER TABLE leitura_contador
    ADD COLUMN IF NOT EXISTS observacao VARCHAR(500);

CREATE INDEX IF NOT EXISTS idx_leitura_contador_com_justificativa
    ON leitura_contador (idfilial_usr, data_leitura DESC)
    WHERE motivo IS NOT NULL OR observacao IS NOT NULL;
