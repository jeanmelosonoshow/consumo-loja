CREATE TABLE IF NOT EXISTS tarifa_referencia (
    id_tarifa BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uf CHAR(2) NOT NULL,
    cidade VARCHAR(100),
    recurso VARCHAR(10) NOT NULL,
    concessionaria VARCHAR(100) NOT NULL,
    valor_unitario NUMERIC(12, 6) NOT NULL,
    unidade VARCHAR(10) NOT NULL,
    data_inicio DATE NOT NULL,
    data_fim DATE,
    fonte_url TEXT,
    status CHAR(1) NOT NULL DEFAULT 'T',

    CONSTRAINT chk_tarifa_referencia_recurso
        CHECK (recurso IN ('ENERGIA', 'AGUA')),

    CONSTRAINT chk_tarifa_referencia_status
        CHECK (status IN ('T', 'F')),

    CONSTRAINT chk_tarifa_referencia_valor
        CHECK (valor_unitario > 0),

    CONSTRAINT chk_tarifa_referencia_periodo
        CHECK (data_fim IS NULL OR data_fim >= data_inicio)
);

CREATE INDEX IF NOT EXISTS idx_tarifa_referencia_busca
    ON tarifa_referencia (uf, recurso, cidade, data_inicio DESC)
    WHERE status = 'T';
