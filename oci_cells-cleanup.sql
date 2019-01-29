ATTACH DATABASE "mls_cells.sqlite" AS mls;
DELETE FROM cells WHERE EXISTS (SELECT * FROM mls.cells mls WHERE mls.mcc = cells.mcc AND mls.mnc = cells.mnc AND mls.lac = cells.lac AND mls.cellid = cells.cellid);
VACUUM;
