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
  const stringTopico = String(topic); // Garante que o tópico é texto
  
  // AQUI ESTÁ A MUDANÇA SEGURA:
  const [primeiraParte, segundaParte] = stringTopico.split("/");

  if (primeiraParte && segundaParte && !isNaN(valor)) {
    // Agora limpamos os textos individualmente
    const nomeTanque = primeiraParte.trim().toLowerCase();
    const nomeSensor = segundaParte.trim().toLowerCase();

    try {
      await collection.insertOne({ 
        tanque: nomeTanque, 
        sensor: nomeSensor, 
        valor: valor, 
        data: new Date() 
      });
      console.log(`💾 DB -> [${nomeTanque}] ${nomeSensor}: ${valor}`);
    } catch (e) {
      console.error("Erro ao inserir:", e);
    }
  }
});

// ==========================================
// ROTAS
// ==========================================

app.get("/api/ping", (req, res) => res.send("Servidor Online! 🚀"));

app.get("/api/limpar", async (req, res) => {
  if (!collection) return res.send("Banco não conectado");
  await collection.deleteMany({});
  res.send("<h1>Banco Limpo! 🧹</h1>");
});

app.get("/api/status/:tanque", async (req, res) => {
  if (!collection) return res.status(503).json({ erro: "Banco ainda conectando..." });
  const tId = String(req.params.tanque).trim().toLowerCase();
  const sensores = ['temperatura_externa', 'umidade_ar', 'nivel', 'luminosidade'];
  const resposta = {};
  try {
    for (let s of sensores) {
      const ultimo = await collection.find({ tanque: tId, sensor: s }).sort({ data: -1 }).limit(1).toArray();
      resposta[s] = ultimo.length > 0 ? ultimo.valor : 0;
    }
    res.json(resposta);
  } catch (err) {
    res.status(500).json({ erro: "Erro ao buscar" });
  }
});

app.post("/api/comando/:tanque", (req, res) => {
  const { dispositivo, estado } = req.body;
  const topico = `${req.params.tanque}/comando/${dispositivo}`;
  mqttClient.publish(topico, String(estado), { qos: 1 });
  res.json({ status: "ok" });
});

app.listen(PORT, () => console.log(`🚀 Online na porta ${PORT}`));