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

// --- 1. CONEXÃO MONGODB ---
mongoClient.connect().then(() => {
  console.log("✅ Conectado ao MongoDB!");
  const db = mongoClient.db("queencarbon");
  collection = db.collection("sensores");
}).catch(err => console.error("❌ Erro Mongo:", err));

// --- 2. CONFIGURAÇÃO MQTT ---
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
  
  // CORREÇÃO AQUI: Garantindo que o split funcione independente de como o tópico venha
  const partes = topic.split("/");
  const tanque = partes; 
  const sensor = partes;

  if (!isNaN(valor) && sensor) {
    try {
      await collection.insertOne({ 
        tanque: tanque, // Agora vai salvar apenas "tanque1"
        sensor: sensor, // Agora vai salvar apenas "temperatura_externa"
        valor: valor, 
        data: new Date() 
      });
      console.log(`💾 Salvo -> Tanque: ${tanque} | Sensor: ${sensor} | Valor: ${valor}`);
    } catch (e) {
      console.error("Erro ao salvar:", e);
    }
  }
});

// --- 3. ROTAS ---

app.get("/api/ping", (req, res) => res.send("Servidor Queen Carbon Online! 🚀"));

// Rota de Status (Monitoramento)
app.get("/api/status/:tanque", async (req, res) => {
  if (!collection) return res.status(503).json({ erro: "Banco ainda conectando..." });
  
  const tanqueId = req.params.tanque;
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
    res.json(resposta);
  } catch (err) {
    res.status(500).json({ erro: "Erro ao buscar dados" });
  }
});

// Rota de Histórico
app.get("/api/historico/:tanque", async (req, res) => {
  if (!collection) return res.status(503).json({ erro: "Banco ainda conectando..." });
  try {
    const dados = await collection
      .find({ tanque: req.params.tanque })
      .sort({ data: -1 })
      .limit(40)
      .toArray();
    res.json(dados.reverse());
  } catch (err) {
    res.status(500).json({ erro: "Erro ao buscar histórico" });
  }
});

// Rota de Comando
app.post("/api/comando/:tanque", (req, res) => {
  const { dispositivo, estado } = req.body;
  const topico = `${req.params.tanque}/comando/${dispositivo}`;
  mqttClient.publish(topico, estado.toString(), { qos: 1 });
  res.json({ status: "ok", enviado: topico });
});

app.listen(PORT, () => console.log(`🚀 API na porta ${PORT}`));