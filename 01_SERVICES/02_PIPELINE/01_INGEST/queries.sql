SELECT b.*,
       d.dist, d.qual, d.unit, d.minus_err, d.plus_err, d.method,
       i.ids AS alias_ids, oat.otypes, h.parent, h.membership,
       st.sptype, st.mespos, st.dispsystem
    FROM  mesDistance d
    LEFT JOIN basic b
        ON d.oidref = b.oid
    LEFT JOIN IDS i
        ON d.oidref = i.oidref
    LEFT JOIN ALLTYPES oat
        ON d.oidref = oat.oidref
    LEFT JOIN H_LINK h
        ON d.oidref = h.child
    LEFT JOIN mesMK st
        ON d.oidref = st.oidref
    WHERE d.unit = 'pc'
        AND d.dist < 30
    ORDER BY dist ASC
