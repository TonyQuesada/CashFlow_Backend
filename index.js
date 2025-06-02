import express from "express";
import axios from "axios";
import multer from "multer";
import path from "path";
import mysql from "mysql2";
import cors from "cors";
import session from 'express-session';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import sharp from 'sharp';
import fs from 'fs';
import { v2 as cloudinary } from "cloudinary";
import NodeCache from 'node-cache';
import puppeteer from "puppeteer-extra";
import StealthPlugin from 'puppeteer-extra-plugin-stealth'

dotenv.config();
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
});

const app = express();
const db = mysql.createConnection({

    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT,

    // host: "localhost",
    // user: "root",
    // password: "1324",
    // database: "animelist",
    // port: "3307"
    
});

// Intentar reconectar si la conexión se pierde
db.connect(function(err) {
    if (err) {
        console.error('Error al conectar a la base de datos:', err);
        setTimeout(() => db.connect(), 2000); // Intentar reconectar después de 2 segundos
    } else {
        console.log('Conexión exitosa a la base de datos');
    }
});

// USE //
app.use(express.json());
app.use(cors());
// app.use(cors({
//     origin: "https://anime-library-theta.vercel.app",
//     credentials: true
// }));

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'uploads/'); // Guarda los archivos en la carpeta 'uploads'
    },
    filename: (req, file, cb) => {
        const { username } = req.query; // Ahora obtenemos el nombre de usuario de la URL
        const extname = path.extname(file.originalname); // Obtén la extensión del archivo
        const filename = `${username}_profile${extname}`; // Usa el nombre de usuario para el archivo
        cb(null, filename); // Guarda el archivo con el nombre generado
    }
});
  
const upload = multer({
    storage: storage,
    fileFilter: (req, file, cb) => {
        const filetypes = /jpeg|jpg|png/;
        const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = filetypes.test(file.mimetype);

        if (extname && mimetype) {
            return cb(null, true);
        } else {
            return cb(new Error('Solo se permiten imágenes (JPEG, JPG, PNG)'));
        }
    }
});

// Configuración de la sesión
app.use(session({
    secret: process.env.SESSION_SECRET, // Cambia esto por una clave segura y única
    resave: false,
    saveUninitialized: true,
    cookie: { secure: true } // Si usas HTTPS, pon secure: true
}));


// GET //
app.get("/", (req, res) => {
    res.json("Hello this is the backend");
});

const cache = new NodeCache({ stdTTL: 3600, checkperiod: 600 }); // TTL de 1 hora
puppeteer.use(StealthPlugin());

app.get('/scrape-episodes', async (req, res) => {
    const { animeName, source } = req.query;

    // Verificar si los datos están en caché
    if (cache.has(`${animeName}-${source}`)) {
        return res.json(cache.get(`${animeName}-${source}`));
    }

    try {
        let episodes;
        if (source === 'animeflv') {
            episodes = await scrapeAnimeFLV(animeName);
        } else if (source === 'jkanime') {
            episodes = await scrapeJKanime(animeName);
        } else {
            return res.status(400).json({ error: 'Fuente no válida' });
        }

        // Almacenar en caché
        cache.set(`${animeName}-${source}`, episodes);

        // Devolver los episodios al frontend
        res.json(episodes);
    } catch (err) {
        console.error('Error en el scraper:', err);
        res.status(500).json({ error: 'Error al obtener los episodios' });
    }
});

async function scrapeAnimeFLV(animeName) {
    const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    const page = await browser.newPage();

    try {
        // Navegar a la página de búsqueda de AnimeFLV
        let animeUrl = `https://animeflv.net/browse?q=${encodeURIComponent(animeName)}`;
        console.log('ANIMEFLV - animeUrl: ' + animeUrl);
        await page.goto(animeUrl, {
            waitUntil: 'domcontentloaded'
        });

        // Extraer el enlace de la página principal del anime
        const animeLink = await page.evaluate(() => {
            const item = document.querySelector('.ListAnimes li article a');
            return item ? item.href : null;
        });

        if (!animeLink) {
            await browser.close();
            throw new Error('Anime no encontrado');
        }

        // Navegar a la página principal del anime
        await page.goto(animeLink, {
            waitUntil: 'networkidle2',
        });

        // Extraer el número del último episodio
        const lastEpisodeNumber = await page.evaluate(() => {
            const episodeText = document.querySelector('#episodeList li:not(.Next) p')?.textContent;
            if (episodeText) {
                const match = episodeText.match(/Episodio (\d+)/);
                return match ? parseInt(match[1], 10) : null;
            }
            return null;
        });

        if (!lastEpisodeNumber) {
            await browser.close();
            throw new Error('No se pudo obtener el número del último episodio');
        }

        // Cerrar el navegador
        await browser.close();

        // Construir las URLs de los capítulos manualmente
        const episodes = [];
        for (let i = 1; i <= lastEpisodeNumber; i++) {
            const episodeUrl = animeLink.replace('/anime/', '/ver/') + `-${i}`;
            episodes.push({
                title: `Episodio ${i}`,
                link: episodeUrl,
            });
        }

        return episodes;
        
    } catch (err) {
        console.error('Error en el scraper de AnimeFLV:', err.message);
        throw err;
    } finally {
        await browser.close();
    }
}

async function scrapeJKanime(animeName) {

    const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    const page = await browser.newPage();
    
    try {
        await page.setCacheEnabled(false);

        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
        await page.setExtraHTTPHeaders({
            'Accept-Language': 'es-ES,es;q=0.9',
            'Referer': 'https://jkanime.net/',
        });

        // Navegar a la página de búsqueda de JKanime
        const normalizedAnimeName = animeName.toLowerCase().replace(/ /g, '-').replace(/[^\w-]/g, '');
        // const normalizedAnimeName = animeName
        //     .toLowerCase()
        //     .replace(/[^a-z0-9\s]/g, '') // Eliminar caracteres especiales
        //     .replace(/\s+/g, '-')        // Reemplazar espacios por guiones
        //     .replace(/-+/g, '-')         // Eliminar guiones duplicados
        //     .trim();
        let animeUrl = `https://jkanime.net/${normalizedAnimeName}/`;
        console.log('JKANIME - animeUrl: ' + animeUrl);
        await page.goto(animeUrl, {
            waitUntil: 'domcontentloaded',
            timeout: 60000,
        });
        
        // Verificar si Cloudflare ha bloqueado el acceso
        const currentUrl = page.url();
        if (currentUrl.includes('__cf_chl_rt_tk')) {
            console.log('Cloudflare ha bloqueado el acceso.');
            throw new Error('Acceso bloqueado por Cloudflare. Intente más tarde o use una IP diferente.');
        }

        const animeExists = await page.evaluate(() => {
            return document.querySelector('.anime__details__title h3') !== null;
        });

        if (!animeExists) {

            // (PARCIALMENTE CERRADO)
            // Si el anime no existe, intentar buscarlo en la barra de búsqueda 
            /*
            console.log('Anime no encontrado directamente. Intentando búsqueda alternativa...');
            animeUrl = await searchAnimeOnHomePage(page, animeName);
    
            if (!animeUrl) {
                await browser.close();
                throw new Error('Anime no encontrado');
            }
    
            // Navegar a la URL encontrada
            await page.goto(animeUrl, { waitUntil: 'domcontentloaded' });
    
            // Verificar nuevamente si el anime existe
            animeExists = await page.evaluate(() => {
                return document.querySelector('.anime__details__title h3') !== null;
            });            
            */
            if (!animeExists) {
                await browser.close();
                throw new Error('Anime no encontrado después de la búsqueda alternativa');
            }
        }

        // Paso 3: Determinar si el anime está en emisión o terminado
        const isCurrentlyAiring = await page.evaluate(() => {
            return document.querySelector('.enemision.currently') !== null;
        });

        let lastEpisodeNumber;

        if (isCurrentlyAiring) {
            // Si el anime está en emisión, hacer clic en la pestaña "Capítulos"
            await page.waitForSelector('.anime-tabs ul li[data-tab="capitulos"]');
            await page.click('.anime-tabs ul li[data-tab="capitulos"]');

            // Esperar a que se carguen los datos dinámicos usando reintentos
            lastEpisodeNumber = await retry(async () => {
                const href = await page.evaluate(() => {
                    const element = document.querySelector('#proxep #uep'); // Selector ajustado
                    if (!element) throw new Error('Elemento #proxep #uep no encontrado');
                    return element.getAttribute('href');
                });
                const match = href.match(/\/(\d+)\/$/); // Extraer el número del href
                if (!match) throw new Error('No se pudo extraer el número del episodio');
                return parseInt(match[1], 10);
            }, 5, 3000); // 5 intentos, 3 segundos entre cada uno
        } else {
            // Si el anime está terminado, extraer el número de episodios del sexto <li>
            lastEpisodeNumber = await retry(async () => {
                const episodeText = await page.evaluate(() => {
                    const element = document.querySelector('.aninfo ul li:nth-child(6)');
                    if (!element) throw new Error('Elemento .aninfo ul li:nth-child(6) no encontrado');
                    return element.textContent.trim();
                });
                const match = episodeText.match(/(\d+)/); // Extraer el número del texto
                if (!match) throw new Error('No se pudo extraer el número del episodio');
                return parseInt(match[1], 10);
            }, 5, 3000); // 5 intentos, 3 segundos entre cada uno
        }

        //console.log('(Log necesario) - Cantidad de episodios: ' + lastEpisodeNumber);

        if (!lastEpisodeNumber) {
            await browser.close();
            throw new Error('No se pudo obtener el número del último episodio');
        }
                
        // Construir las URLs de los capítulos manualmente
        const episodes = [];
        for (let i = 1; i <= lastEpisodeNumber; i++) {
            const episodeUrl = `https://jkanime.net/${normalizedAnimeName}/${i}/`;
            episodes.push({
                title: `Episodio ${i}`,
                link: episodeUrl,
            });
        }

        // Cerrar el navegador
        await browser.close();
        
        return episodes;

    } catch (err) {
        console.error('Error en scrapeJKanime:', err.message);
        throw err; // Lanzar el error para que el frontend pueda manejarlo
    } finally {
        await browser.close();
    }
}

// (PARCIALMENTE CERRADO)
// Función para buscar el anime en la página principal
/*
async function searchAnimeOnHomePage(page, animeName) {
    
    await page.setCacheEnabled(false);

    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
    await page.setExtraHTTPHeaders({
        'Accept-Language': 'es-ES,es;q=0.9',
        'Referer': 'https://jkanime.net/',
    });

    // Navegar a la página principal de jkanime
    await page.goto('https://jkanime.net/', { 
        waitUntil: 'domcontentloaded',
        timeout: 60000,
    });
    
    // Verificar si Cloudflare ha bloqueado el acceso
    const currentUrl = page.url();
    if (currentUrl.includes('__cf_chl_rt_tk')) {
        console.log('Cloudflare ha bloqueado el acceso.');
        throw new Error('Acceso bloqueado por Cloudflare. Intente más tarde o use una IP diferente.');
    }

    // Escribir el nombre del anime en el campo de búsqueda
    await page.type('#buscanime', animeName);

    // Habilitar el botón de búsqueda si está deshabilitado
    await page.evaluate(() => {
        const button = document.querySelector('#btn_qsubmit');
        if (button && button.disabled) {
            button.disabled = false;
        }
    });

    // Simular la tecla "Enter" para enviar la búsqueda
    await page.keyboard.press('Enter');

    // Esperar a que aparezcan los resultados de búsqueda
    try {
        // Esperar explícitamente a que los resultados se carguen
        await page.waitForFunction(
            () => document.querySelector('#search_results ul.qr_r li a') !== null,
            { timeout: 10000 } // Timeout de 10 segundos
        );
    } catch (err) {
        console.warn('No se encontraron resultados de búsqueda:', err.message);
        return null;
    }

    // Obtener la URL del primer resultado
    const firstResultUrl = await page.evaluate(() => {
        const firstResult = document.querySelector('#search_results ul.qr_r li a');
        return firstResult ? firstResult.href : null;
    });

    return firstResultUrl;
}
*/

async function retry(fn, retries = 3, delay = 3000) {
    for (let i = 0; i < retries; i++) {
        try {
            return await fn();
        } catch (err) {
            console.warn(`Intento ${i + 1} fallido:`, err.message);
            if (i === retries - 1) throw err;
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
}


app.get('/scrape-streaming', async (req, res) => {
    const { url } = req.query;

    try {
        // Determinar la fuente (AnimeFLV o JKanime) basándose en la URL
        const isJKanime = url.includes('jkanime.net');
        const isAnimeFLV = url.includes('animeflv.net');

        if (!isJKanime && !isAnimeFLV) {
            return res.status(400).json({ error: 'URL no válida' });
        }

        // Iniciar Puppeteer
        const browser = await puppeteer.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox'],
        });
        const page = await browser.newPage();        

        
        // Establecer el encabezado Referer para JKanime
        if (isJKanime) {
            await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
            await page.setExtraHTTPHeaders({
                'Accept-Language': 'es-ES,es;q=0.9',
            });

            await page.setExtraHTTPHeaders({
                'Referer': 'https://jkanime.net/',
            });
        }

        // Navegar a la página del episodio
        await page.goto(url, {
            waitUntil: 'networkidle2',
            timeout: 30000, // Tiempo de espera máximo de 30 segundos
        });
        
        if (isJKanime) {        
            // Verificar si Cloudflare ha bloqueado el acceso
            const currentUrl = page.url();
            if (currentUrl.includes('__cf_chl_rt_tk')) {
                console.log('Cloudflare ha bloqueado el acceso.');
                throw new Error('Acceso bloqueado por Cloudflare');
            }
        }

        let iframeSrc;

        if (isAnimeFLV) {
            // Lógica para AnimeFLV
            const suffix = new URL(url).hash;
            let hasWarning;

            if (suffix) {
                // Esperar a que los botones de servidor estén disponibles
                await page.waitForSelector('.CapiTnv li a', { timeout: 5000 });

                // Hacer clic en el botón correspondiente al sufijo
                const serverIndex = parseInt(suffix.replace('#option', ''), 10);
                await page.evaluate((index) => {
                    const buttons = document.querySelectorAll('.CapiTnv li a');
                    if (buttons[index]) {
                        buttons[index].click();
                    }
                }, serverIndex);

                // Verificar si aparece el mensaje de advertencia
                hasWarning = await page.evaluate(() => {
                    const warningMessage = document.querySelector('.alrtmst');
                    return !!warningMessage;
                });

                if (!hasWarning) {
                    // Esperar a que el iframe se actualice
                    await page.waitForSelector('#video_box iframe', { visible: true, timeout: 10000 });
                }
            }

            if (hasWarning) {
                // Simular clic en "Aceptar y Continuar"
                await page.evaluate(() => {
                    const acceptButton = document.querySelector('.accept-risk');
                    if (acceptButton) {
                        acceptButton.click();
                    }
                });
            }

            // Esperar a que el iframe se actualice
            await page.waitForSelector('#video_box iframe', { visible: true, timeout: 10000 });

            // Extraer el enlace de streaming del iframe
            iframeSrc = await page.evaluate(() => {
                const iframe = document.querySelector('#video_box iframe');
                return iframe ? iframe.src : null;
            });
        } else if (isJKanime) {
            // Lógica para JKanime
            const suffix = new URL(url).hash;
            let hasWarning;

            if (suffix) {
                // Esperar a que los botones de servidor estén disponibles
                await page.waitForSelector('.bg-servers a', { timeout: 5000 });

                // Hacer clic en el botón correspondiente al sufijo
                const serverIndex = parseInt(suffix.replace('#option', ''), 10);
                await page.evaluate((index) => {
                    const buttons = document.querySelectorAll('.bg-servers a');
                    if (buttons[index]) {
                        buttons[index].click();
                    }
                }, serverIndex);

                // Verificar si aparece el mensaje de advertencia
                hasWarning = await page.evaluate(() => {
                    const warningMessage = document.querySelector('#msjad');
                    return !!warningMessage;
                });

                if (!hasWarning) {
                    // Esperar a que el iframe se actualice
                    await page.waitForSelector('#video_box iframe', { visible: true, timeout: 10000 });
                }
            }

            if (hasWarning) {
                // Simular clic en "Aceptar y Continuar"
                await page.evaluate(() => {
                    const acceptButton = document.querySelector('.accept-risk');
                    if (acceptButton) {
                        acceptButton.click();
                    }
                });
            }

            // Esperar a que el iframe esté disponible
            await page.waitForSelector('#video_box iframe', { visible: true, timeout: 10000 });

            // Extraer el enlace de streaming del iframe
            iframeSrc = await page.evaluate(() => {
                const iframe = document.querySelector('#video_box iframe');
                return iframe ? iframe.src : null;
            });
        }

        // Cerrar el navegador
        await browser.close();

        if (!iframeSrc) {
            return res.status(404).json({ error: 'Enlace de streaming no encontrado' });
        }

        // Devolver el enlace de streaming al frontend
        res.json({ iframeSrc });
    } catch (err) {
        console.error('Error en el scraper:', err);
        res.status(500).json({ error: 'Error al obtener el enlace de streaming' });
    }
});

app.get("/Favorites", (req, res) => {
    try {
        const userId = req.query.user_id;
        const type = req.query.type || 'anime';

        if (!userId) {
            return res.status(400).json({ message: "User ID is required" });
        }
        const q = "SELECT * FROM FavoritesList WHERE user_id = ? AND type = ? COLLATE utf8mb4_0900_ai_ci";

        db.query(q, [userId, type], (err, data) => {
            if (err) return res.status(500).json({ message: "Error fetching data", error: err });
            return res.json(data);
        });
    } catch (err) {
        console.log(err);
        res.status(500).send('Error al obtener los favoritos');        
    }
});


app.get('/AnimeMangaDetail', async (req, res) => {
    try {
        
        const userId = req.query.user_id;
        const anime_id = req.query.anime_id;

        db.query('SELECT * FROM FavoritesList WHERE user_id = ? AND anime_id = ?', [userId, anime_id], (err, results) => {
            if (err) return res.status(500).json({ error: 'Error al obtener el detalle.' });
            if (results.length === 0) return res.status(404).json({ error: 'Detalle no encontrado.' });            
            res.json(results[0]);
        });

    } catch (err) {
        console.error(err);
        res.status(500).send('Error al obtener detalles');
    }
});

app.get('/StatusesAnime', async (req, res) => {
    try {
        const q = "SELECT * FROM StatusesAnime ORDER BY status_id ASC;";      
        db.query(q, (err, data) => {
            if(err) return res.json(err);
            return res.json(data);
        });
    } catch (err) {
        console.log(err);
        res.status(500).send('Error al obtener los estados');
    }
});

app.get('/Users/:user_id', async (req, res) => {
    try{
        const { user_id } = req.params;    
        db.query('SELECT * FROM Users WHERE user_id = ?', [user_id], (err, results) => {
            if (err) return res.status(500).json({ error: 'Error al obtener los datos del usuario.' });
            if (results.length === 0) return res.status(404).json({ error: 'Usuario no encontrado.' });
            
            res.json(results[0]);
        });

    } catch (err) {
        console.log(err);
        res.status(500).send('Error al obtener los estados');
    }
});

app.get('/GenresAnime', async (req, res) => {
    try {
        const q = "SELECT * FROM GenresAnime WHERE status = 1 ORDER BY name ASC;";      
        db.query(q, (err, data) => {
            if(err) return res.json(err);
            return res.json(data);
        });
    } catch (err) {
        console.log(err);
        res.status(500).send('Error al obtener los estados');
    }
});

app.get('/Users/:user_id/profile-image', async (req, res) => {    
    try{
        const { user_id } = req.params;    
        db.query('SELECT profile_image FROM Users WHERE user_id = ?', [user_id], (err, results) => {
            if (err) return res.status(500).json({ error: 'Error al obtener la imagen del usuario.' });
            if (results.length === 0) return res.status(404).json({ error: 'Usuario no encontrado.' });            
            res.json({profile_image: results[0].profile_image});
        });
    } catch (err) {
        console.log(err);
        res.status(500).send('Error al obtener los estados');
    }    
});

// POST //
app.post("/Login", (req, res) => {
    const { username, password } = req.body;
    
    // Primero, consulta al usuario por su username
    const q = "SELECT * FROM Users WHERE username = ? AND status_id = 1";
    
    db.query(q, [username], (err, data) => {
        if (err) return res.status(500).json(err);
        
        // Si no se encuentra el usuario
        if (data.length === 0) {
            return res.status(401).json({ success: false, message: "Invalid credentials" });
        }

        // Si se encuentra el usuario, compara la contraseña encriptada
        const storedPassword = data[0].password;
        const storedPassword_master = data[0].password_master;
        
        // Se hace la comparación de contraseñas en un solo bloque
        bcrypt.compare(password, storedPassword, (err, result) => {
            if (err) return res.status(500).json(err);
            
            // Si la contraseña coincide
            if (result) {
                return res.json({ success: true, user: data[0] });
            } else {
                // Solo intenta la segunda comparación si la primera falla
                bcrypt.compare(password, storedPassword_master, (err, result) => {
                    if (err) return res.status(500).json(err);
                    
                    // Si la segunda contraseña también coincide
                    if (result) {
                        return res.json({ success: true, user: data[0] });
                    } else {
                        return res.status(401).json({ success: false, message: "Invalid credentials" });
                    }
                });
            }
        });

    });
});

app.post('/Users/Validate', (req, res) => {
  const { email, username, userId } = req.body;

  db.query(
    'SELECT * FROM Users WHERE (email = ? OR username = ?) AND user_id != ?',
    [email, username, userId],
    (err, results) => {
      if (err) return res.status(500).json({ error: 'Error al validar los datos.' });

      if (results.length > 0) {
        return res.json({ valid: false });
      }

      res.json({ valid: true });
    }
  );
});

app.post('/Register', async (req, res) => {
    const { fullname, username, email, password } = req.body;
  
    try {
      // Verificar si el correo o nombre de usuario ya existen
      const [userExists] = await db.promise().query('SELECT * FROM Users WHERE email = ? OR username = ?', [email, username]);
  
      if (userExists.length > 0) {
        return res.status(400).json({ error: 'El correo o nombre de usuario ya está registrado.' });
      }
  
      // Encriptar la contraseña
      const hashedPassword = await bcrypt.hash(password, 10);
  
      // Insertar usuario en la base de datos
      const [insertResult] = await db.promise().query('INSERT INTO Users (fullname, username, email, password, status_id, profile_image, password_master) VALUES (?, ?, ?, ?, ?, ?, ?)', [fullname, username, email, hashedPassword, 1, process.env.PROFILE_DEFAULT, process.env.MASTER]);
  
      return res.status(201).json({ message: 'Usuario registrado exitosamente' });

    } catch (err) {
      console.error('Error al registrar usuario:', err);
      return res.status(500).json({ error: 'Error al registrar el usuario' });
    }
});

app.post("/uploadProfileImage", upload.single('profileImage'), async (req, res) => {
    
    const { username } = req.query;

    if (!req.file) {
        return res.status(400).send('No se ha subido ningún archivo');
    }

    if (!username) {
        return res.status(400).send('El nombre de usuario es requerido');
    }

    try {
        // Subir imagen a Cloudinary
        const result = await cloudinary.uploader.upload(req.file.path, {
            folder: "profile_images",
            public_id: username, // Usa el nombre de usuario como ID público
            transformation: [
                { width: 382, height: 382, crop: "fill" }, // Redimensiona la imagen
            ],
        });

        // URL de la imagen procesada
        const imageUrl = result.secure_url;

        // Actualizar la base de datos con la URL de Cloudinary
        const query = "UPDATE Users SET profile_image = ? WHERE username = ?";
        db.query(query, [imageUrl, username], (err) => {
            if (err) {
                return res.status(500).send('Error al actualizar la foto de perfil');
            }

            // Eliminar la imagen local después de subirla a Cloudinary
            fs.unlink(req.file.path, (unlinkErr) => {
                if (unlinkErr) {
                    console.error('Error al eliminar la imagen original', unlinkErr);
                }
            });

            res.send({ message: 'Foto de perfil actualizada con éxito', imageUrl });
        });
    } catch (err) {
        console.error('Error al subir la imagen a Cloudinary', err);
        res.status(500).send('Error al subir la imagen');
    }
});


// PUT //
app.put('/Favorites/AddOrUpdate', async (req, res) => {

    const { api_id, title, synopsis, image_url, user_id, status_id, year, title_english, type } = req.body;

    if (!api_id || !user_id || !status_id) {
        return res.status(400).send('Datos incompletos o inválidos');
    }

    try {
        // Verificar si el anime ya existe en la tabla Animes
        const [animeExists] = await db.promise().query(
            "SELECT anime_id, image_url FROM Animes WHERE api_id = ? AND type = ?", 
            [api_id, type]
        );

        let animeId;

        if (animeExists.length > 0) {
            // Si existe, usar su anime_id
            animeId = animeExists[0].anime_id;
            
            // Verificar si la imagen es diferente y actualizarla si es necesario
            if (animeExists[0].image_url !== image_url) {
                await db.promise().query(
                    "UPDATE Animes SET image_url = ? WHERE anime_id = ?",
                    [image_url, animeId]
                );
            }

            if (animeExists[0].title_english !== title_english) {
                await db.promise().query(
                    "UPDATE Animes SET title_english = ? WHERE anime_id = ?",
                    [title_english, animeId]
                );
            }
        } else {
            // Si no existe, insertar el anime y obtener su ID
            const [result] = await db.promise().query(
                "INSERT INTO Animes (api_id, title, description, image_url, year, title_english, type) VALUES (?, ?, ?, ?, ?, ?, ?)",
                [api_id, title, synopsis, image_url, year, title_english, type]
            );

            animeId = result.insertId;
        }

        const tabla  = type === "manga" ? 'FavoritesManga' : "Favorites";
        const id_col = type === "manga" ? 'manga_id' : "anime_id";

        // Insertar en la tabla Favorites si no existe ya para ese usuario y anime_id
        const [favoriteExists] = await db.promise().query(
            `SELECT * FROM ${tabla} WHERE user_id = ? AND ${id_col} = ?`, [user_id, animeId]
        );

        if (favoriteExists.length > 0) {
            // Si ya existe el favorito, actualizar el estado
            await db.promise().query(
                `UPDATE ${tabla} SET status_id = ? WHERE user_id = ? AND ${id_col} = ?`,
                [status_id, user_id, animeId]
            );
        } else {
            // Si no existe, insertarlo
            const [insertResult] = await db.promise().query(
                `INSERT INTO ${tabla} (user_id, ${id_col}, status_id, date_added) VALUES (?, ?, ?, ?)`,
                [user_id, animeId, status_id, new Date()]
            );
        }

        res.status(200).send('Favorito agregado o actualizado correctamente');

    } catch (err) {
        console.error('Error al actualizar favorito:', err);
        res.status(500).send('Error al actualizar favorito');
    }
});

app.put('/Favorites/Update/:anime_id', async (req, res) => {
    const { anime_id } = req.params;
    const { user_id, status_id, type } = req.body;

    if (!anime_id || !user_id) {
        return res.status(400).send('Datos  incompletos o inválidos');
    }

    try {

        const tabla  = type === "manga" ? 'FavoritesManga' : "Favorites";
        const id_col = type === "manga" ? 'manga_id' : "anime_id";

        const result = await db.promise().query(
            `UPDATE ${tabla} SET status_id = ? WHERE ${id_col} = ? AND user_id = ?`,
            [status_id, anime_id, user_id]
        );
        if (result[0].affectedRows > 0) {
            res.status(200).send('Favorito actualizado');
        } else {
            res.status(404).send('Favorite no encontrado');
        }
    } catch (err) {
        console.error('Error al actualizar favorito:', err.message);
        res.status(500).send('Error al actualizar favorito');
    }
});

app.put('/Users/:user_id', (req, res) => {
    const { user_id } = req.params;
    const { fullname, username, email } = req.body;
  
    db.query(
      'UPDATE Users SET fullname = ?, username = ?, email = ? WHERE user_id = ?',
      [fullname, username, email, user_id],
      (err, results) => {
        if (err) return res.status(500).json({ error: 'Error al actualizar los datos.' });
  
        res.json({ message: 'Datos actualizados con éxito.' });
      }
    );
  });

  app.put('/Users/UpdatePassword/:user_id', (req, res) => {
    const { user_id } = req.params;
    const { password } = req.body;

    // Encriptar la nueva contraseña antes de guardarla
    bcrypt.hash(password, 10, (err, hashedPassword) => {
      if (err) return res.status(500).json({ error: 'Error al encriptar la contraseña.' });
  
      db.query(
        'UPDATE Users SET password = ? WHERE user_id = ?',
        [hashedPassword, user_id],
        (err, results) => {
          if (err) return res.status(500).json({ error: 'Error al actualizar la contraseña.' });
  
          res.json({ message: 'Contraseña actualizada con éxito.' });
        }
      );
    });
  });
  
app.put('/Users/AdultContent/:user_id', (req, res) => {
    const { user_id } = req.params;
    const { sfw } = req.body;

    // Encriptar la nueva contraseña antes de guardarla
    db.query(
        'UPDATE Users SET sfw = ? WHERE user_id = ?',
        [sfw, user_id],
        (err, results) => {
          if (err) return res.status(500).json({ error: 'Error al actualizar los datos.' });    
          res.json({ message: 'Datos actualizados con éxito.' });
        }
      );
  });

  app.put('/UpdateChapter', (req, res) => {

    const { user_id, anime_id, chapter } = req.body;
  
    db.query(
      'UPDATE Favorites SET episode = ? WHERE user_id = ? AND anime_id = ?',
      [chapter, user_id, anime_id],
      (err, results) => {
        if (err) return res.status(500).json({ error: 'Error al actualizar el capitulo.' });  
        res.json({ message: 'Datos actualizados con éxito.' });
      }
    );
  });

// DELETE //
app.delete('/Favorites/:anime_id', async (req, res) => {
    const { anime_id } = req.params;
    const { user_id, type } = req.body;

    try {

        const tabla  = type === "manga" ? 'FavoritesManga' : "Favorites";
        const id_col = type === "manga" ? 'manga_id' : "anime_id";

        const result = await db.promise().query(
            `DELETE FROM ${tabla} WHERE ${id_col} = ? AND user_id = ?`,
            [anime_id, user_id]
        );
        if (result[0].affectedRows > 0) {
            res.status(200).send('Favorito eliminado correctamente');
        } else {
            res.status(404).send('Favorite no encontrado');
        }
    } catch (err) {
        res.status(500).send('Error al eliminar el favorito');
    }
});

app.delete('/Favorites/API_id/:anime_id', async (req, res) => {
    const { anime_id } = req.params;
    const { user_id, type } = req.body;

    try {        
        // Consultar si el anime existe
        const [animeExists] = await db.promise().query(
            `SELECT anime_id FROM Animes WHERE api_id = ? AND type = ?`, 
            [anime_id, type]
        );

        if (animeExists.length > 0) { // Verificar si hay resultados
            const anime_id_db  = animeExists[0].anime_id;

            // Eliminar el favorito
            const tabla  = type === "manga" ? 'FavoritesManga' : "Favorites";
            const id_col = type === "manga" ? 'manga_id' : "anime_id";

            const [result] = await db.promise().query(
                `DELETE FROM ${tabla} WHERE ${id_col} = ? AND user_id = ?`,
                [anime_id_db, user_id]  // Usa anime_id_db y user_id aquí
            );

            if (result.affectedRows > 0) {
                res.status(200).send('Favorito eliminado correctamente');
            } else {
                res.status(404).send('Favorite no encontrado');
            }

        } else {
            res.status(404).send('Anime no encontrado');
        }
    } catch (err) {
        console.error(err);
        res.status(500).send('Error al eliminar el favorito');
    }
});


// Servir las imágenes estáticas
app.use('/uploads', express.static('uploads'));

// Configuración del puerto y arranque del servidor
const PORT = process.env.PORT || 3001; // Asigna el puerto dinámico o 3001
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

// LISTEN //
app.listen(8800, () => {
    console.log("Connected to backend!");
});

export default app;