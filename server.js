require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { MongoClient } = require("mongodb");
const mqtt = require("mqtt");

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const mongoClient = new MongoClient(process.env.MONGO_URI);
let collection;

// 1. CONEXÃO MONGODB
mongoClient.connect().then(() => {
  console.log("✅ Conectado ao MongoDB!");
  collection = mongoClient.db("queencarbon").collection("sensores");
}).catch(err => console.error("❌ Erro Mongo:", err));

// 2. CONFIGURAÇÃO MQTT
const mqttClient = mqtt.connect({
  host: process.env.MQTT_HOST,
  port: 8883,
  protocol: "mqtts",
  username: process.env.MQTT_USER,
  password: process.env.MQTT_PASS,
});

mqttClient.on("connect", () => {
  console.log("✅ Conectado ao HiveMQ!");
  mqttClient.subscribe("tanque1/#");
  mqttClient.subscribe("tanque2/#");
});

mqttClient.on("message", async (topic, message) => {
  if (topic.includes("comando") || !collection) return;

  const valor = parseFloat(message.toString());
  // Divide o tópico e limpa qualquer espaço ou caractere invisível
  const partes = topic.split("/");
  const tanque = partes.trim();
  const sensor = partes.trim();

  if (!isNaN(valor) && sensor) {
    try {
      await collection.insertOne({ 
        tanque: tanque, 
        sensor: sensor, 
        valor: valor, 
        data: new Date() 
      });
      console.log(`💾 SALVO NO DB -> Tanque: [${tanque}] | Sensor: [${sensor}] | Valor: ${valor}`);
    } catch (e) {
      console.error("Erro ao inserir:", e);
    }
  }
});

// ==========================================
// ROTAS DE DIAGNÓSTICO E USO
// ==========================================

// ROTA DE DEBUG: Mostra os últimos 10 itens salvos no banco (SEM FILTRO)
app.get("/api/debug/db", async (req, res) => {
  if (!collection) return res.send("Banco não conectado");
  const dados = await collection.find({}).sort({ data: -1 }).limit(10).toArray();
  res.json(dados);
});

// Rota de Status (Monitoramento)
app.get("/api/status/:tanque", async (req, res) => {
  if (!collection) return res.status(503).json({ erro: "Banco ainda conectando..." });
  
  const tanqueId = req.params.tanque.trim();
  const sensores = ['temperatura_externa', 'umidade_ar', 'nivel', 'luminosidade'];
  const resposta = {};
  
  try {
    for (let s of sensores) {
      const ultimo = await collection
        .find({ tanque: tanqueId, sensor: s })
        .sort({ data: -1 })
        .limit(1)
        .toArray();
      
      resposta[s] = ultimo.length > 0 ? ultimo.valor : 0;
    }
    // Se o objeto resposta estiver todo zerado, avisamos
    res.json(resposta);
  } catch (err) {
    res.status(500).json({ erro: "Erro ao buscar dados" });
  }
});

app.post("/api/comando/:tanque", (req, res) => {
  const { dispositivo, estado } = req.body;
  const topico = `${req.params.tanque}/comando/${dispositivo}`;
  mqttClient.publish(topico, estado.toString(), { qos: 1 });
  res.json({ status: "ok", enviado: topico });
});

app.listen(PORT, () => console.log(`🚀 Online na porta ${PORT}`));