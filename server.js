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

// --- 1. CONEXÃO COM O BANCO ---
mongoClient.connect().then(() => {
  console.log("✅ Conectado ao MongoDB!");
  const db = mongoClient.db("queencarbon");
  collection = db.collection("sensores");
}).catch(err => console.error("❌ Erro Mongo:", err));

// --- 2. CONFIGURAÇÃO MQTT (AQUI ESTAVA O PROBLEMA) ---
const mqttClient = mqtt.connect({
  host: process.env.MQTT_HOST,
  port: 8883,
  protocol: "mqtts",
  username: process.env.MQTT_USER,
  password: process.env.MQTT_PASS,
});

mqttClient.on("connect", () => {
  console.log("✅ Conectado ao HiveMQ!");
  // ESSENCIAIS: Sem essas linhas, o servidor não recebe os sensores!
  mqttClient.subscribe("tanque1/#");
  mqttClient.subscribe("tanque2/#");
});

mqttClient.on("message", async (topic, message) => {
  // Se for comando, não salva no banco de dados
  if (topic.includes("comando") || !collection) return;

  const valor = parseFloat(message.toString());
  const partes = topic.split("/");
  const tanque = partes;
  const sensor = partes;

  if (!isNaN(valor)) {
    try {
      await collection.insertOne({ 
        tanque, 
        sensor, 
        valor, 
        data: new Date() 
      });
      // Log para você ver no painel do Render se os dados estão chegando
      console.log(`💾 Recebido [${tanque}]: ${sensor} = ${valor}`);
    } catch (e) {
      console.error("Erro ao salvar no banco:", e);
    }
  }
});

// --- 3. ROTAS DA API ---

app.get("/api/ping", (req, res) => res.send("Servidor Queen Carbon Online! 🚀"));

// Rota de Status (Monitoramento)
app.get("/api/status/:tanque", async (req, res) => {
  if (!collection) return res.status(503).json({ erro: "Banco ainda conectando..." });
  
  const sensores = ['temperatura_externa', 'umidade_ar', 'nivel', 'luminosidade'];
  const resposta = {};
  
  try {
    for (let s of sensores) {
      const ultimo = await collection
        .find({ tanque: req.params.tanque, sensor: s })
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

// Rota de Histórico (Gráfico)
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

// Rota de Comando (Controle)
app.post("/api/comando/:tanque", (req, res) => {
  const { dispositivo, estado } = req.body;
  const topico = `${req.params.tanque}/comando/${dispositivo}`;
  mqttClient.publish(topico, estado.toString(), { qos: 1 });
  console.log(`📤 Comando: ${topico} -> ${estado}`);
  res.json({ status: "ok", enviado: topico });
});

app.listen(PORT, () => console.log(`🚀 API Queen Carbon na porta ${PORT}`));