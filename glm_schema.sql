CREATE TABLE cells (
    mcc INTEGER,
    mnc INTEGER,
    lac INTEGER,
    cellid INTEGER,
    lon FLOAT,
    lat FLOAT,
    range INTEGER
);
CREATE INDEX cells_idx ON cells(mcc, mnc, lac, cellid);
