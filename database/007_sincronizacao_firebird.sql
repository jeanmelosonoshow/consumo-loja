CREATE TABLE IF NOT EXISTS sincronizacao_firebird (
    id_sincronizacao BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    idfilial_usr VARCHAR(30) NOT NULL,
    data_leitura DATE NOT NULL,
    status VARCHAR(15) NOT NULL DEFAULT 'PENDENTE',
    tentativas INTEGER NOT NULL DEFAULT 0,
    data_criacao TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    data_ultima_tentativa TIMESTAMPTZ,
    data_sincronizacao TIMESTAMPTZ,
    mensagem_erro TEXT,

    CONSTRAINT uq_sincronizacao_firebird
        UNIQUE (idfilial_usr, data_leitura),

    CONSTRAINT chk_status_sincronizacao
        CHECK (status IN ('PENDENTE', 'PROCESSANDO', 'SINCRONIZADO', 'ERRO')),

    CONSTRAINT chk_tentativas_sincronizacao
        CHECK (tentativas >= 0)
);

CREATE INDEX IF NOT EXISTS idx_sincronizacao_firebird_status
    ON sincronizacao_firebird (status, data_leitura, idfilial_usr);
