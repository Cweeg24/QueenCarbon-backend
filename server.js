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
  // Ignora se for comando ou se o banco não estiver pronto
  if (topic.includes("comando") || !collection) return;

  const valor = parseFloat(message.toString());
  
  // AQUI ESTÁ A MUDANÇA: Extração segura
  const partes = topic.split("/");
  
  if (partes.length >= 2 && !isNaN(valor)) {
    // Pegamos os textos PRIMEIRO, e só depois limpamos os espaços
    const nomeTanque = String(partes).trim();
    const nomeSensor = String(partes).trim();

    try {
      await collection.insertOne({ 
        tanque: nomeTanque, 
        sensor: nomeSensor, 
        valor: valor, 
        data: new Date() 
      });
      console.log(`💾 [${nomeTanque}] ${nomeSensor}: ${valor}`);
    } catch (e) {
      console.error("Erro ao inserir:", e);
    }
  }
});

// ==========================================
// ROTAS DA API
// ==========================================

app.get("/api/ping", (req, res) => res.send("Servidor Queen Carbon Online! 🚀"));

// Rota de Debug para ver o que tem no banco
app.get("/api/debug/db", async (req, res) => {
  if (!collection) return res.send("Banco não conectado");
  const dados = await collection.find({}).sort({ data: -1 }).limit(10).toArray();
  res.json(dados);
});

// Rota de Status (Monitoramento do App)
app.get("/api/status/:tanque", async (req, res) => {
  if (!collection) return res.status(503).json({ erro: "Banco ainda conectando..." });
  
  const tanqueId = String(req.params.tanque).trim();
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
      .find({ tanque: String(req.params.tanque).trim() })
      .sort({ data: -1 })
      .limit(40)
      .toArray();
    res.json(dados.reverse());
  } catch (err) {
    res.status(500).json({ erro: "Erro ao buscar histórico" });
  }
});

// Rota de Comando (Relés)
app.post("/api/comando/:tanque", (req, res) => {
  const { dispositivo, estado } = req.body;
  const topico = `${req.params.tanque}/comando/${dispositivo}`;
  mqttClient.publish(topico, String(estado), { qos: 1 });
  console.log(`📤 Comando: ${topico} -> ${estado}`);
  res.json({ status: "ok" });
});

app.listen(PORT, () => console.log(`🚀 Online na porta ${PORT}`));