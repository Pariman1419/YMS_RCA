package com.nexus.yms;
import com.google.gson.*;
import com.zaxxer.hikari.*;
import com.sun.net.httpserver.*;
import java.net.*;
import java.io.*;
import java.sql.*;
import java.time.*;
import java.util.*;
import java.util.concurrent.*;
import java.security.MessageDigest;
import java.nio.charset.StandardCharsets;

public final class Bridge {
 static final Gson JSON=new Gson();
 static final Map<String,HikariDataSource> POOLS=new ConcurrentHashMap<>();
 static String env(String key,String fallback){return System.getenv().getOrDefault(key,fallback);}
 static synchronized HikariDataSource pool(String source){
  if(!source.equals("1")&&!source.equals("2"))throw new IllegalArgumentException("Unregistered Oracle source");
  if(POOLS.containsKey(source))return POOLS.get(source);
  String prefix="SOURCE_DB_"+source+"_";
  HikariConfig c=new HikariConfig();
  c.setJdbcUrl("jdbc:oracle:thin:@//"+env(prefix+"HOST","")+":"+env(prefix+"PORT","1521")+"/"+env(prefix+"SERVICE",""));
  c.setUsername(env(prefix+"USERNAME",""));c.setPassword(env(prefix+"PASSWORD",""));
  c.setDriverClassName("oracle.jdbc.OracleDriver");c.setMaximumPoolSize(4);c.setMinimumIdle(0);
  c.setConnectionTimeout(10000);c.setValidationTimeout(5000);c.setInitializationFailTimeout(-1);
  c.addDataSourceProperty("oracle.net.CONNECT_TIMEOUT","10000");
  c.addDataSourceProperty("oracle.jdbc.timezoneAsRegion","false");
  c.addDataSourceProperty("oracle.jdbc.ReadTimeout",env("ORACLE_CALL_TIMEOUT_MS","30000"));
  c.setPoolName("oracle-source-"+source);
  HikariDataSource p=new HikariDataSource(c);POOLS.put(source,p);return p;
 }
 static void reply(HttpExchange x,int code,String message)throws IOException {
  byte[] b=JSON.toJson(Collections.singletonMap("message",message)).getBytes(StandardCharsets.UTF_8);
  x.getResponseHeaders().set("Content-Type","application/json");x.sendResponseHeaders(code,b.length);x.getResponseBody().write(b);x.close();
 }
 static String safe(Throwable e){
  while(e.getCause()!=null && e.getCause()!=e) e=e.getCause();
  if(e instanceof SQLException){SQLException s=(SQLException)e;return "Oracle JDBC error "+s.getErrorCode()+": "+s.getMessage().replaceAll("[\\r\\n]+"," ").substring(0,Math.min(600,s.getMessage().replaceAll("[\\r\\n]+"," ").length()));}
  return "JDBC extraction failed ("+e.getClass().getSimpleName()+")";
 }
 static void extract(HttpExchange x)throws IOException {
  String expected="Bearer "+env("JDBC_BRIDGE_TOKEN","");String actual=x.getRequestHeaders().getFirst("Authorization");
  if(actual==null||!MessageDigest.isEqual(expected.getBytes(StandardCharsets.UTF_8),actual.getBytes(StandardCharsets.UTF_8))){reply(x,401,"Bridge authentication required");return;}
  if(!x.getRequestMethod().equals("POST")){reply(x,405,"POST required");return;}
  boolean sent=false;
  try {
   byte[] bytes=x.getRequestBody().readNBytes(1048577);if(bytes.length>1048576){reply(x,413,"Request too large");return;}
   JsonObject body=JsonParser.parseString(new String(bytes,StandardCharsets.UTF_8)).getAsJsonObject();
   String sql=body.get("sql").getAsString();
   if(!sql.trim().toUpperCase(Locale.ROOT).startsWith("SELECT")||sql.contains(";")) {reply(x,400,"Single SELECT required");return;}
   boolean test=body.has("test")&&body.get("test").getAsBoolean();
   try(Connection c=pool(body.get("source").getAsString()).getConnection()) {
    c.setAutoCommit(false);
    try {
     try(Statement readOnly=c.createStatement()){readOnly.execute("SET TRANSACTION READ ONLY");}
     try(PreparedStatement p=c.prepareStatement(test ? "SELECT * FROM ("+sql+") WHERE ROWNUM <= 5" : sql,ResultSet.TYPE_FORWARD_ONLY,ResultSet.CONCUR_READ_ONLY)){
      p.setFetchSize(test?5:1000);p.setQueryTimeout(test?60:3600);if(test)p.setMaxRows(5);
      JsonArray binds=body.getAsJsonArray("binds");for(int i=0;i<binds.size();i++){
       JsonElement bind=binds.get(i);
       if(bind.isJsonObject()&&bind.getAsJsonObject().get("type").getAsString().equals("string"))p.setString(i+1,bind.getAsJsonObject().get("value").getAsString());
       else p.setTimestamp(i+1,Timestamp.from(Instant.parse(bind.getAsString())),Calendar.getInstance(TimeZone.getTimeZone("UTC")));
      }
      try(ResultSet r=p.executeQuery()){
       x.getResponseHeaders().set("Content-Type","application/x-ndjson");x.sendResponseHeaders(200,0);sent=true;
       BufferedWriter out=new BufferedWriter(new OutputStreamWriter(x.getResponseBody(),StandardCharsets.UTF_8));
       ResultSetMetaData m=r.getMetaData();List<Map<String,Object>> rows=new ArrayList<>();long deadline=System.nanoTime()+TimeUnit.SECONDS.toNanos(test?60:3600);
       while(r.next()){
        if(System.nanoTime()>deadline)throw new SQLException("JDBC extraction deadline exceeded");
        Map<String,Object> row=new LinkedHashMap<>();
        for(int i=1;i<=m.getColumnCount();i++){
         int type=m.getColumnType(i);Object value;
         if(type==Types.DATE||type==Types.TIMESTAMP||type==Types.TIMESTAMP_WITH_TIMEZONE){Timestamp t=r.getTimestamp(i,Calendar.getInstance(TimeZone.getTimeZone("UTC")));value=t==null?null:t.toInstant().toString();}
         else if(type==Types.NUMERIC||type==Types.DECIMAL)value=r.getBigDecimal(i);
         else value=r.getString(i);
         row.put(m.getColumnLabel(i).toUpperCase(Locale.ROOT),value);
        }
        rows.add(row);if(rows.size()>=1000){out.write(JSON.toJson(Collections.singletonMap("rows",rows))+"\n");out.flush();rows.clear();}
       }
       if(!rows.isEmpty())out.write(JSON.toJson(Collections.singletonMap("rows",rows))+"\n");
       out.write("{\"done\":true}\n");out.flush();
      }
     }
    } finally {c.rollback();}
   }
  }catch(Exception e){String message=safe(e);System.err.println(message);if(sent){try{x.getResponseBody().write((JSON.toJson(Collections.singletonMap("error",message))+"\n").getBytes(StandardCharsets.UTF_8));}catch(IOException ignored){}}else reply(x,502,message);}
  finally{x.close();}
 }
 public static void main(String[] args)throws Exception{
  if(env("JDBC_BRIDGE_TOKEN","").length()<32)throw new IllegalStateException("JDBC_BRIDGE_TOKEN must contain at least 32 characters");
  HttpServer server=HttpServer.create(new InetSocketAddress(4010),16);
  ThreadPoolExecutor executor=new ThreadPoolExecutor(8,8,0,TimeUnit.SECONDS,new ArrayBlockingQueue<>(32));
  server.setExecutor(executor);server.createContext("/extract",Bridge::extract);
  server.createContext("/health",x->reply(x,200,"ready"));server.start();
  Runtime.getRuntime().addShutdownHook(new Thread(()->{server.stop(2);executor.shutdownNow();POOLS.values().forEach(HikariDataSource::close);}));
  System.out.println("Oracle JDBC bridge ready on port 4010");
 }
}
