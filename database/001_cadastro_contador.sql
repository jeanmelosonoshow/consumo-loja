CREATE TABLE IF NOT EXISTS cadastro_contador (
    id_contador BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    idfilial_usr VARCHAR(30) NOT NULL,
    apelido_contador VARCHAR(60) NOT NULL,
    numero_contador VARCHAR(50) NOT NULL,
    tipo_contador VARCHAR(10) NOT NULL,
    data_cadastro TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT chk_cadastro_contador_tipo
        CHECK (tipo_contador IN ('ENERGIA', 'AGUA')),

    CONSTRAINT uq_cadastro_contador_filial_tipo_numero
        UNIQUE (idfilial_usr, tipo_contador, numero_contador)
);

CREATE INDEX IF NOT EXISTS idx_cadastro_contador_filial
    ON cadastro_contador (idfilial_usr, tipo_contador);
