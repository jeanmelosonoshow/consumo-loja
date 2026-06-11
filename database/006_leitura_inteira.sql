ALTER TABLE leitura_contador
    DROP CONSTRAINT IF EXISTS chk_leitura_contador_inteira;

ALTER TABLE leitura_contador
    ADD CONSTRAINT chk_leitura_contador_inteira
    CHECK (leitura = TRUNC(leitura))
    NOT VALID;

ALTER TABLE leitura_contador
    DROP CONSTRAINT IF EXISTS chk_leitura_anterior_contador_inteira;

ALTER TABLE leitura_contador
    ADD CONSTRAINT chk_leitura_anterior_contador_inteira
    CHECK (leitura_anterior IS NULL OR leitura_anterior = TRUNC(leitura_anterior))
    NOT VALID;
