CREATE TABLE cells (
    radio TEXT,
    mcc INTEGER,
    mnc INTEGER,
    lac INTEGER,
    cellid INTEGER,
    unit INTEGER,
    lon FLOAT,
    lat FLOAT,
    range INTEGER,
    nbSamples INTEGER,
    changeable INTEGER,
    created_at INTEGER,
    updated_at INTEGER,
    average_signal INTEGER
);
CREATE INDEX cells_idx ON cells(mcc, mnc, lac, cellid);
