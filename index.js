import express from "express";
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