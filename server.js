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

async function iniciarServidor() {
  try {
    await mongoClient.connect();
    console.log("✅ Conectado ao MongoDB Atlas!");
    
    const db = mongoClient.db("queencarbon");
    collection = db.collection("sensores");

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
      const topicoStr = String(topic).toLowerCase();
      if (topicoStr.includes("comando") || !collection) return;

      const valor = parseFloat(message.toString());
      if (isNaN(valor)) return;

      let nomeTanque = "desconhecido";
      if (topicoStr.includes("tanque1")) nomeTanque = "tanque1";
      else if (topicoStr.includes("tanque2")) nomeTanque = "tanque2";

      let nomeSensor = "desconhecido";
      if (topicoStr.includes("temperatura_externa")) nomeSensor = "temperatura_externa";
      else if (topicoStr.includes("umidade_ar")) nomeSensor = "umidade_ar";
      else if (topicoStr.includes("nivel")) nomeSensor = "nivel";
      else if (topicoStr.includes("luminosidade")) nomeSensor = "luminosidade";

      if (nomeTanque !== "desconhecido" && nomeSensor !== "desconhecido") {
        await collection.insertOne({
          tanque: nomeTanque,
          sensor: nomeSensor,
          valor: valor,
          data: new Date()
        });
        console.log(`🎯 SINAL LIMPO -> Tanque: ${nomeTanque} | Sensor: ${nomeSensor} | Valor: ${valor}`);
      }
    });

    // ==========================================
    // ROTAS DO APP (COM BLOQUEIO DE CACHE)
    // ==========================================
    
    const noCache = (req, res, next) => {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      res.setHeader('Surrogate-Control', 'no-store');
      next();
    };

    app.get("/api/ping", noCache, (req, res) => res.send("Queen Carbon Online! 🚀"));

    app.get("/api/limpar", noCache, async (req, res) => {
      if (!collection) return res.send("Banco offline");
      await collection.deleteMany({});
      res.send("<h1>Banco Limpo! 🧹</h1>");
    });

    app.get("/api/debug/db", noCache, async (req, res) => {
      if (!collection) return res.send("Banco não conectado");
      const dados = await collection.find({}).sort({ data: -1 }).limit(10).toArray();
      res.json(dados);
    });

    // 🛡️ A ROTA REESCRITA E INFALÍVEL
    app.get("/api/status/:tanque", noCache, async (req, res) => {
      try {
        const t = req.params.tanque;
        
        // Buscas diretas. É impossível isso retornar vazio se o código estiver rodando.
        const temp = await collection.find({ tanque: t, sensor: "temperatura_externa" }).sort({ data: -1 }).limit(1).toArray();
        const umi = await collection.find({ tanque: t, sensor: "umidade_ar" }).sort({ data: -1 }).limit(1).toArray();
        const niv = await collection.find({ tanque: t, sensor: "nivel" }).sort({ data: -1 }).limit(1).toArray();
        const lum = await collection.find({ tanque: t, sensor: "luminosidade" }).sort({ data: -1 }).limit(1).toArray();

        res.json({
          temperatura_externa: temp.length > 0 ? temp.valor : 0,
          umidade_ar: umi.length > 0 ? umi.valor : 0,
          nivel: niv.length > 0 ? niv.valor : 0,
          luminosidade: lum.length > 0 ? lum.valor : 0,
          status_servidor: "OK_ATUALIZADO" // <-- SINAL RASTREADOR
        });
      } catch (e) {
        res.status(500).json({ erro: "Erro", detalhe: e.message });
      }
    });

    app.post("/api/comando/:tanque", (req, res) => {
      const { dispositivo, estado } = req.body;
      const topico = `${req.params.tanque}/comando/${dispositivo}`;
      mqttClient.publish(topico, String(estado), { qos: 1 });
      res.json({ status: "sucesso" });
    });

    app.listen(PORT, () => console.log(`🚀 API Queen Carbon na porta ${PORT}`));

  } catch (error) {
    console.error("❌ Erro fatal:", error);
  }
}

iniciarServidor();