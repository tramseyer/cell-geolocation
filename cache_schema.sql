CREATE TABLE cells (
    mcc INTEGER,
    mnc INTEGER,
    lac INTEGER,
    cellid INTEGER,
    lon FLOAT,
    lat FLOAT,
    range INTEGER,
    created_at INTEGER,
    updated_at INTEGER
);
CREATE INDEX cells_idx ON cells(mcc, mnc, lac, cellid);
