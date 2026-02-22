#!/usr/bin/python

import requests
import urllib
import io
import os
import pandas as pd
# from sqlalchemy import create_engine




# query = """SELECT * 
#     FROM  mesDistance d
#     LEFT JOIN basic b
#         ON d.oidref = b.oid
#     LEFT JOIN IDS i
#         ON d.oidref = i.oidref
#     LEFT JOIN ALLTYPES oat
#         ON d.oidref = oat.oidref
#     LEFT JOIN OTYPEDEF otd
#         ON b.otype = otd.otype
#     LEFT JOIN H_LINK h
#         ON d.oidref = h.child
#     WHERE d.unit = 'pc'
#         AND d.dist < 30
#     ORDER BY dist ASC
# """

class Simbad:
    def __init__(self, engine, version):

        self.engine = engine
        self.version = version

        # Query to grab all objects under 50 LY
        self.q_basic = """SELECT DISTINCT B.* 
                FROM BASIC B
                JOIN mesDistance D
                ON B.oid = D.oidref
                AND D.dist <= 50
                """

        # OTYPES + OTYPEDEF custom query
        self.q_otype = """SELECT OT.oidref, OT.otype,
                    OTD.otype_longname, OTD.otype_shortname
                    FROM OTYPES OT
                    LEFT JOIN OTYPEDEF OTD
                    ON OT.otype = OTD.otype
                    JOIN mesDistance D
                    ON OT.oidref = D.oidref
                    AND D.dist <= 50
                    """

        # OTYPES + OTYPEDEF custom query
        self.q_dist = """SELECT *
                    FROM mesDistance D
                    WHERE D.dist <= 50
                    """

        # The list of objects that follow a formula that can be brought over
        self.table_list = [
            'mesVAR', 'mesVelocities', 'mesRot', 'mesPM', 'IDENT', 'ALLFLUXES', 'MESDIAMETER', 'MESPM',
            'MESVELOCITIES', 'MESIUE', 'MESHERSCHEL', 'MESFE_H', 'MESMK', 'MESPLX'
            ]

    # REST Call for CSV Grab
    def fetch_simbad(engine, query, target_table):
        url_code = 'http://simbad.u-strasbg.fr/simbad/sim-tap/sync?request=doQuery&lang=adql&format=text&' + \
                   'query=' + urllib.parse.quote(query)
        # 'query=SELECT%20TOP%2010%20MAIN_ID,RA,DEC%20FROM%20BASIC%20WHERE%20rvz_redshift%20%3E%203.3'

        print('Running data for {}'.format(target_table))
        # print(url_code)
        urlData = requests.get(url_code).content
        df_simbad = pd.read_csv(io.StringIO(urlData.decode('utf-8')), sep='|', skiprows=[1], header=0,
                                skipinitialspace=True)
        print(df_simbad.head(5))

        df_simbad.columns = df_simbad.columns.str.strip()
        df_simbad.to_sql(target_table, engine, schema='stg_data', if_exists='replace')


    # Using the formulaic join format, use the inner join to pull all the necessary tables
    def run_etl(self):

        self.fetch_simbad(self.q_basic, 'simbad_basic_v'+str(self.version))
        self.fetch_query(self.q_otype, 'simbad_otype_v'+str(self.version))
        self.fetch_query(self.q_dist, 'simbad_dist_v'+str(self.version))

        for src_table in self.table_list:

            q_template = """SELECT DISTINCT A.* 
                        FROM {} A
                        JOIN mesDistance D
                        ON A.oidref = D.oidref
                        AND D.dist <= 50
                """.format(src_table)

            self.fetch_query(q_template,  'simbad_' + src_table.lower() + '_v'+str(self.version))

