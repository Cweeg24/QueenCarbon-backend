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
      mqttClient.subscribe("tanque1,+"); // Captura caso o formato venha com vírgula
    });

    mqttClient.on("message", async (topic, message) => {
      const topicoStr = String(topic).toLowerCase();
      if (topicoStr.includes("comando") || !collection) return;

      const valor = parseFloat(message.toString());
      if (isNaN(valor)) return; // Ignora se não for número

      // 🛡️ FILTRO ABSOLUTO: Procura a palavra exata, ignorando qualquer sujeira
      let nomeTanque = "desconhecido";
      if (topicoStr.includes("tanque1")) nomeTanque = "tanque1";
      else if (topicoStr.includes("tanque2")) nomeTanque = "tanque2";

      let nomeSensor = "desconhecido";
      if (topicoStr.includes("temperatura_externa")) nomeSensor = "temperatura_externa";
      else if (topicoStr.includes("umidade_ar")) nomeSensor = "umidade_ar";
      else if (topicoStr.includes("nivel")) nomeSensor = "nivel";
      else if (topicoStr.includes("luminosidade")) nomeSensor = "luminosidade";

      // Só salva no banco se identificou com clareza quem é o tanque e o sensor
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
    // ROTAS DO APP
    // ==========================================
    
    app.get("/api/ping", (req, res) => res.send("Queen Carbon Online! 🚀"));

    // Rota de faxina
    app.get("/api/limpar", async (req, res) => {
      if (!collection) return res.send("Banco offline");
      await collection.deleteMany({});
      res.send("<h1>Banco Limpo! 🧹</h1>");
    });

    app.get("/api/status/:tanque", async (req, res) => {
      try {
        const tanqueId = req.params.tanque;
        const sensores = ['temperatura_externa', 'umidade_ar', 'nivel', 'luminosidade'];
        const resposta = {};

        for (let s of sensores) {
          const ultimoDado = await collection
            .find({ tanque: tanqueId, sensor: s })
            .sort({ data: -1 })
            .limit(1)
            .toArray();

          resposta[s] = ultimoDado.length > 0 ? ultimoDado.valor : 0;
        }
        res.json(resposta);
      } catch (e) {
        res.status(500).json({ erro: "Erro ao buscar dados" });
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