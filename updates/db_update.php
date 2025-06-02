<?php

// Establecer conexión a la base de datos
$host = '';
$db = '';
$user = '';
$pass = '';
$port = '';
$pdo = new PDO("mysql:host=$host;port=$port;dbname=$db", $user, $pass);

// Obtener los animes que no tienen title_english
$query = "SELECT anime_id, api_id, image_url FROM Animes WHERE title_english IS NULL";
$stmt = $pdo->query($query);
$animes = $stmt->fetchAll(PDO::FETCH_ASSOC);

foreach ($animes as $anime) {
    $api_id = $anime['api_id'];
    
    // Hacer la solicitud al API de Jikan
    $url = "https://api.jikan.moe/v4/anime/$api_id";
    $response = file_get_contents($url);
    $data = json_decode($response, true);

    // Verificar si la respuesta contiene el campo title_english
    if (isset($data['data']['title_english']) && !empty($data['data']['title_english'])) {
        $title_english = $data['data']['title_english'];
    } else {
        // Si no hay title_english, asignamos el title normal
        $title_english = $data['data']['title'];
    }

    // Verificar si la URL de la imagen en la base de datos es diferente a la del API
    $image_url_api = $data['data']['images']['jpg']['large_image_url'];
    if ($anime['image_url'] !== $image_url_api) {
        // Si las URLs no coinciden, actualizamos la URL de la imagen
        $updateImageQuery = "UPDATE Animes SET image_url = :image_url WHERE anime_id = :anime_id";
        $updateImageStmt = $pdo->prepare($updateImageQuery);
        $updateImageStmt->execute(['image_url' => $image_url_api, 'anime_id' => $anime['anime_id']]);
        
        echo "* Imagen Actualizada para Anime ID: " . $anime['anime_id'];
        echo "<br/>";
    }

    // Actualizar el título en inglés (o el título normal) en la base de datos
    $updateQuery = "UPDATE Animes SET title_english = :title_english WHERE anime_id = :anime_id";
    $updateStmt = $pdo->prepare($updateQuery);
    $updateStmt->execute(['title_english' => $title_english, 'anime_id' => $anime['anime_id']]);

    echo "- Titulo Actualizado: " . $title_english;
    echo "<br/>";
}

echo "Actualización completada.";

?>
