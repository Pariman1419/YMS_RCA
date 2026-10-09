-- Starting rule definitions are disabled until manufacturing engineering approves thresholds.
INSERT INTO alert_rule(id,name,type,threshold,enabled) VALUES
 ('yield-target','Yield below target','yield',98,false),
 ('scrap-high','High scrap','scrap',3,false),
 ('machine-abnormal','Machine abnormality','machine',5,false),
 ('spc-violation','SPC violation','spc',1,false),
 ('defect-spike','Defect spike','defect',2,false)
ON CONFLICT(name) DO NOTHING;
