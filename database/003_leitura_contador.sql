CREATE TABLE IF NOT EXISTS leitura_contador (
    id_leitura BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    idfilial_usr VARCHAR(30) NOT NULL,
    id_contador BIGINT NOT NULL,
    data_leitura DATE NOT NULL,
    leitura NUMERIC(18, 3) NOT NULL,
    leitura_anterior NUMERIC(18, 3),
    data_registro TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_leitura_contador_contador
        FOREIGN KEY (id_contador)
        REFERENCES cadastro_contador (id_contador)
        ON UPDATE CASCADE
        ON DELETE RESTRICT,

    CONSTRAINT uq_leitura_contador_data
        UNIQUE (id_contador, data_leitura),

    CONSTRAINT chk_leitura_contador_valor
        CHECK (leitura >= 0),

    CONSTRAINT chk_leitura_contador_valor_anterior
        CHECK (leitura_anterior IS NULL OR leitura_anterior >= 0)
);

CREATE INDEX IF NOT EXISTS idx_leitura_contador_filial_data
    ON leitura_contador (idfilial_usr, data_leitura DESC);

CREATE INDEX IF NOT EXISTS idx_leitura_contador_contador_data
    ON leitura_contador (id_contador, data_leitura DESC);

CREATE OR REPLACE FUNCTION preparar_nova_leitura_contador()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    filial_contador VARCHAR(30);
    proxima_leitura NUMERIC(18, 3);
BEGIN
    SELECT idfilial_usr
      INTO filial_contador
      FROM cadastro_contador
     WHERE id_contador = NEW.id_contador;

    IF filial_contador IS NULL THEN
        RAISE EXCEPTION 'Contador % não encontrado.', NEW.id_contador;
    END IF;

    NEW.idfilial_usr := filial_contador;

    SELECT leitura
      INTO NEW.leitura_anterior
      FROM leitura_contador
     WHERE id_contador = NEW.id_contador
       AND data_leitura < NEW.data_leitura
     ORDER BY data_leitura DESC
     LIMIT 1;

    IF NEW.leitura_anterior IS NOT NULL
       AND NEW.leitura < NEW.leitura_anterior THEN
        RAISE EXCEPTION
            'A leitura informada (%) não pode ser menor que a leitura anterior (%).',
            NEW.leitura,
            NEW.leitura_anterior
            USING ERRCODE = '23514';
    END IF;

    SELECT leitura
      INTO proxima_leitura
      FROM leitura_contador
     WHERE id_contador = NEW.id_contador
       AND data_leitura > NEW.data_leitura
     ORDER BY data_leitura ASC
     LIMIT 1;

    IF proxima_leitura IS NOT NULL
       AND NEW.leitura > proxima_leitura THEN
        RAISE EXCEPTION
            'A leitura retroativa informada (%) não pode ser maior que a próxima leitura registrada (%).',
            NEW.leitura,
            proxima_leitura
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_preparar_nova_leitura_contador
    ON leitura_contador;

CREATE TRIGGER trg_preparar_nova_leitura_contador
BEFORE INSERT ON leitura_contador
FOR EACH ROW
EXECUTE FUNCTION preparar_nova_leitura_contador();

CREATE OR REPLACE FUNCTION atualizar_proxima_leitura_contador()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    UPDATE leitura_contador
       SET leitura_anterior = NEW.leitura
     WHERE id_leitura = (
        SELECT id_leitura
          FROM leitura_contador
         WHERE id_contador = NEW.id_contador
           AND data_leitura > NEW.data_leitura
         ORDER BY data_leitura ASC
         LIMIT 1
     );

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_atualizar_proxima_leitura_contador
    ON leitura_contador;

CREATE TRIGGER trg_atualizar_proxima_leitura_contador
AFTER INSERT ON leitura_contador
FOR EACH ROW
EXECUTE FUNCTION atualizar_proxima_leitura_contador();
