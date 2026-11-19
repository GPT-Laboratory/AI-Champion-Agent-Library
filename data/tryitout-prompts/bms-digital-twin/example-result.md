## Point checks
P-01 name=AHU-01.SAT prefix=AHU-01 | asset_lines="AHU-01,Air handling unit 1,equipment" multi=N | desc="supply air temperature" hint_line="supply air temperature,SYN-Supply_Air_Temperature_Sensor,C,12,24" | unit=C exp=C unit_ok=Y | binding=bound
P-02 name=RM-201.CO2 prefix=RM-201 | asset_lines="RM-201,Meeting room 201,space" multi=N | desc="room co2" hint_line="co2,SYN-CO2_Sensor,ppm,400,1000" | unit=ppm exp=ppm unit_ok=Y | binding=bound
P-03 name=AHU-09.SAT prefix=AHU-09 | asset_lines=NONE multi=- | desc="supply air temperature" hint_line="supply air temperature,SYN-Supply_Air_Temperature_Sensor,C,12,24" | unit=C exp=C unit_ok=Y | binding=unbound
P-04 name=AHU-01.RAT prefix=AHU-01 | asset_lines="AHU-01,Air handling unit 1,equipment" multi=N | desc="return air temp" hint_line=NONE | unit=C exp=- unit_ok=- | binding=untagged
P-05 name=FAN-03.SPD prefix=FAN-03 | asset_lines="FAN-03,Fan 3,equipment" multi=N | desc="fan speed command" hint_line="fan speed command,SYN-Fan_Speed_Command,%,0,100" | unit=rpm exp=% unit_ok=N | binding=unit-mismatch
P-06 name=PMP-05.DP prefix=PMP-05 | asset_lines="PMP-05,Heating pump 5,equipment / PMP-05,Pump 5 (duplicate id in export),equipment" multi=Y | desc="pump discharge pressure" hint_line="discharge pressure,SYN-Discharge_Pressure_Sensor,kPa,100,400" | unit=kPa exp=kPa unit_ok=Y | binding=ambiguous

## Point mapping

| point_id | asset_id | tag | unit | reading | low | high | binding | status | review | note |
|---|---|---|---|---|---|---|---|---|---|---|
| P-01 | AHU-01 | SYN-Supply_Air_Temperature_Sensor | C | 18.5 | 12 | 24 | bound | to compute (tool) | NO | - |
| P-02 | RM-201 | SYN-CO2_Sensor | ppm | 1350 | 400 | 1000 | bound | to compute (tool) | NO | - |
| P-03 | UNMAPPED | SYN-Supply_Air_Temperature_Sensor | C | 17.0 | 12 | 24 | unbound | to compute (tool) | YES | asset AHU-09 not in asset list |
| P-04 | AHU-01 | UNTAGGED | C | 21.0 | - | - | untagged | to compute (tool) | YES | no tag hint matches description |
| P-05 | FAN-03 | SYN-Fan_Speed_Command | rpm | 1200 | 0 | 100 | unit-mismatch | to compute (tool) | YES | unit differs rpm vs %, not converted |
| P-06 | AMBIGUOUS | SYN-Discharge_Pressure_Sensor | kPa | 250 | 100 | 400 | ambiguous | to compute (tool) | YES | asset PMP-05 listed twice |

## Open items for the engineer
P-03, asset AHU-09 is not in the asset list
P-04, no tag hint keyword is contained in the description
P-05, the point unit rpm differs from the expected unit %, not converted
P-06, asset PMP-05 is listed twice in the asset list
Readings against limits: to compute (tool) for every point; run scripts/bms-point-status.ts.

Draft for engineer review. Bindings and tags are proposals from the supplied hint table; thresholds and statuses are computed by a tool; no BMS was contacted and no ontology was validated.
