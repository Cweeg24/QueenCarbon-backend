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

    // ==========================================
    // RECEBIMENTO DE DADOS DA ESP32
    // ==========================================
    mqttClient.on("message", async (topic, message) => {
      const topicoStr = String(topic).toLowerCase();
      if (topicoStr.includes("comando") || !collection) return;

      const valor = parseFloat(message.toString());
      if (isNaN(valor)) return;

      let nomeTanque = "desconhecido";
      if (topicoStr.includes("tanque1")) nomeTanque = "tanque1";
      else if (topicoStr.includes("tanque2")) nomeTanque = "tanque2";

      // ⚠️ ATUALIZADO: Reconhecendo os novos sensores
      let nomeSensor = "desconhecido";
      if (topicoStr.includes("temperatura_externa")) nomeSensor = "temperatura_externa";
      else if (topicoStr.includes("umidade_ar")) nomeSensor = "umidade_ar";
      else if (topicoStr.includes("nivel")) nomeSensor = "nivel";
      else if (topicoStr.includes("luminosidade")) nomeSensor = "luminosidade";
      else if (topicoStr.includes("temperatura_agua")) nomeSensor = "temperatura_agua"; // NOVO: DS18B20
      else if (topicoStr.includes("gas_mq7")) nomeSensor = "gas_mq7"; // NOVO: MQ-7

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
      const dados = await collection.find({}).sort({ _id: -1 }).limit(10).toArray();
      res.json(dados);
    });

    // 🛡️ A ROTA DEFINITIVA COM RAIO-X (ATUALIZADA)
    app.get("/api/status/:tanque", noCache, async (req, res) => {
      try {
        const t = String(req.params.tanque).replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
        
        console.log(`[API] Navegador pediu os dados do tanque: '${t}'`);

        // Busca de todos os sensores
        const temp = await collection.findOne({ tanque: t, sensor: "temperatura_externa" }, { sort: { _id: -1 } });
        const umi = await collection.findOne({ tanque: t, sensor: "umidade_ar" }, { sort: { _id: -1 } });
        const niv = await collection.findOne({ tanque: t, sensor: "nivel" }, { sort: { _id: -1 } });
        const lum = await collection.findOne({ tanque: t, sensor: "luminosidade" }, { sort: { _id: -1 } });
        const tempAgua = await collection.findOne({ tanque: t, sensor: "temperatura_agua" }, { sort: { _id: -1 } }); // NOVO
        const gas = await collection.findOne({ tanque: t, sensor: "gas_mq7" }, { sort: { _id: -1 } }); // NOVO

        console.log(`[API] Banco achou -> Temp Ar: ${temp ? temp.valor : 'NADA'} | Temp Água: ${tempAgua ? tempAgua.valor : 'NADA'}`);

        res.json({
          temperatura_externa: temp ? temp.valor : 0,
          umidade_ar: umi ? umi.valor : 0,
          nivel: niv ? niv.valor : 0,
          luminosidade: lum ? lum.valor : 0,
          temperatura_agua: tempAgua ? tempAgua.valor : 0, // NOVO: Manda para o App
          gas_mq7: gas ? gas.valor : 0, // NOVO: Manda para o App
          status_servidor: "OK_RAIO_X",
          tanque_buscado: t 
        });
      } catch (e) {
        res.status(500).json({ erro: "Erro", detalhe: e.message });
      }
    });

    // 📊 ROTA DE HISTÓRICO 
    app.get("/api/historico/:tanque", noCache, async (req, res) => {
      try {
        const t = String(req.params.tanque).replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
        const sensorReq = String(req.query.sensor);
        const periodo = String(req.query.periodo); // "1h", "24h" ou "7d"

        if (!sensorReq) return res.status(400).json({ erro: "Sensor não informado" });

        console.log(`[API Histórico] Tanque: ${t} | Sensor: ${sensorReq} | Período: ${periodo}`);

        const dataCorte = new Date();
        if (periodo === "1h") dataCorte.setHours(dataCorte.getHours() - 1);
        else if (periodo === "7d") dataCorte.setDate(dataCorte.getDate() - 7);
        else dataCorte.setHours(dataCorte.getHours() - 24); 

        const historico = await collection.find({
          tanque: t,
          sensor: sensorReq,
          data: { $gte: dataCorte }
        })
        .sort({ data: 1 }) 
        .toArray();

        let dadosFormatados = historico.map(d => ({
          timestamp: d.data,
          valor: d.valor
        }));

        const maxPontos = 15;
        if (dadosFormatados.length > maxPontos) {
          const passo = Math.ceil(dadosFormatados.length / maxPontos);
          dadosFormatados = dadosFormatados.filter((_, index) => index % passo === 0);
        }

        res.json(dadosFormatados);
      } catch (e) {
        res.status(500).json({ erro: "Erro no servidor", detalhe: e.message });
      }
    });

    // 🕹️ ROTA DE COMANDO (RECEBE DO APP E MANDA PARA A ESP32)
    app.post("/api/comando/:tanque", (req, res) => {
      const { dispositivo, estado } = req.body;
      const topico = `${req.params.tanque}/comando/${dispositivo}`; // Se vier "bomba", vira "tanque1/comando/bomba"
      mqttClient.publish(topico, String(estado), { qos: 1 });
      res.json({ status: "sucesso", detalhe: `Comando enviado para ${topico}` });
    });

    app.listen(PORT, () => console.log(`🚀 API Queen Carbon rodando na porta ${PORT}`));

  } catch (error) {
    console.error("❌ Erro fatal:", error);
  }
}

iniciarServidor();