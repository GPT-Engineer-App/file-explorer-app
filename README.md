# file-explorer-app

import os
import mimetypes
from http import HTTPStatus
from urllib.parse import unquote
import socket
import shutil
import logging
import base64
import requests
import csv

from flask import Flask, render_template, request, send_from_directory, redirect, url_for, jsonify
from werkzeug.utils import secure_filename

app = Flask(__name__)

# Configuration du serveur de fichiers
SHARED_DIRECTORY = r'\\LENOVO\Users\WV_LMMS2\Desktop\DOCSEM'  # Remplacez par le chemin de votre répertoire partagé
UPLOAD_FOLDER = os.path.join(SHARED_DIRECTORY, 'uploads')  # Dossier pour les uploads

app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)  # Créez le dossier uploads si nécessaire

logging.basicConfig(level=logging.INFO)

# Cache pour les fichiers statiques (HTML, CSS, JS)
app.config['SEND_FILE_MAX_AGE_DEFAULT'] = 3600  # 1 heure en secondes

class FileHandler:
    def __init__(self, shared_directory):
        self.shared_directory = shared_directory

    def handle_GET(self, path):
        full_path = os.path.join(self.shared_directory, path)
        if os.path.isdir(full_path):
            return self.handle_directory_listing(full_path)
        elif os.path.isfile(full_path):
            return self.handle_file_download(full_path)
        else:
            return HTTPStatus.NOT_FOUND, "File not found"

    def handle_directory_listing(self, full_path):
        # Optimisation: Utilisez os.scandir() pour une meilleure performance
        file_list = []
        for entry in os.scandir(full_path):
            file_path = entry.path
            size = entry.stat().st_size if entry.is_file() else ''
            is_dir = entry.is_dir()
            file_list.append({
                'name': entry.name,
                'path': base64.b64encode(file_path.encode('utf-8')).decode('utf-8'),
                'is_dir': is_dir,
                'size': size,
                'icon': 'folder' if is_dir else 'file',
                'checked': False
            })
        return HTTPStatus.OK, file_list, 'application/json'

    def handle_file_download(self, full_path):
        mime_type, _ = mimetypes.guess_type(full_path)
        if not mime_type:
            mime_type = "application/octet-stream"
        return HTTPStatus.OK, full_path, mime_type

    def handle_POST(self, path, data):
        full_path = os.path.join(self.shared_directory, path)
        with open(full_path, 'wb') as f:
            shutil.copyfileobj(data, f)
        return HTTPStatus.OK, "File uploaded successfully"

    def handle_DELETE(self, path):
        full_path = os.path.join(self.shared_directory, path)
        try:
            if os.path.isfile(full_path):
                os.remove(full_path)
            elif os.path.isdir(full_path):
                shutil.rmtree(full_path)
            return HTTPStatus.OK, "File/Directory deleted successfully"
        except Exception as e:
            logging.error(f"Error deleting file/directory: {e}")
            return HTTPStatus.INTERNAL_SERVER_ERROR, f"Error deleting file/directory: {e}"

@app.route('/', defaults={'path': ''}, methods=['GET'])
@app.route('/<path:path>', methods=['GET'])
def index(path):
    return render_template('index.html')

@app.route('/files', defaults={'path': ''}, methods=['GET'])
@app.route('/files/<path:path>', methods=['GET'])
def files(path):
    try:
        file_handler = FileHandler(SHARED_DIRECTORY)
        # Décoder le chemin en base64
        path = base64.b64decode(path.encode('utf-8')).decode('utf-8')
        status_code, content, mime_type = file_handler.handle_GET(path)
        if status_code == HTTPStatus.OK:
            # Convertir 'content' en un tableau d'objets JSON
            return jsonify(content)
        else:
            return content, status_code
    except requests.exceptions.RequestException as e:
        return f"Erreur lors de la récupération des fichiers: {e}", HTTPStatus.INTERNAL_SERVER_ERROR

@app.route('/download/<path:path>')
def download(path):
    path = base64.b64decode(path.encode('utf-8')).decode('utf-8')
    file_handler = FileHandler(SHARED_DIRECTORY)
    status_code, content, mime_type = file_handler.handle_GET(path)
    if status_code == HTTPStatus.OK:
        return send_from_directory(SHARED_DIRECTORY, path, as_attachment=True)
    else:
        return content, status_code
    
@app.route('/download_folder/<path:path>')
def download_folder(path):
    path = base64.b64decode(path.encode('utf-8')).decode('utf-8')
    folder_path = os.path.join(SHARED_DIRECTORY, path)

    # Vérifier si le chemin est un dossier
    if not os.path.isdir(folder_path):
        return "Ce chemin n'est pas un dossier", HTTPStatus.BAD_REQUEST

    # Créer une archive du dossier
    try:
        archive_name = os.path.basename(folder_path) + ".zip"
        archive_path = os.path.join(app.config['UPLOAD_FOLDER'], archive_name)
        shutil.make_archive(archive_path[:-4], 'zip', folder_path)
    except Exception as e:
        return f"Erreur lors de la création de l'archive: {e}", HTTPStatus.INTERNAL_SERVER_ERROR

    # Renvoyer l'archive au client
    return send_from_directory(app.config['UPLOAD_FOLDER'], archive_name, as_attachment=True)

@app.route('/upload', methods=['POST'])
def upload():
    if 'files' not in request.files:
        return 'No file part', HTTPStatus.BAD_REQUEST

    for file in request.files.getlist('files'):
        if file.filename == '':
            return 'No selected file', HTTPStatus.BAD_REQUEST

        # Vérifier si c'est un dossier
        if file.filename.endswith(os.path.sep):
            # Uploader le dossier de manière récursive
            upload_folder(file, os.path.join(app.config['UPLOAD_FOLDER'], secure_filename(file.filename)))
        else:
            # Uploader le fichier
            filename = secure_filename(file.filename)
            filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
            file.save(filepath)

    return redirect(url_for('index'))

def upload_folder(folder, target_path):
    """Upload un dossier de manière récursive."""
    os.makedirs(target_path, exist_ok=True)
    for item in folder:
        if item.filename.endswith(os.path.sep):
            # Si c'est un dossier, uploader le récursivement
            upload_folder(item, os.path.join(target_path, secure_filename(item.filename)))
        else:
            # Si c'est un fichier, l'uploader
            item.save(os.path.join(target_path, secure_filename(item.filename)))

@app.route('/create_folder', methods=['POST'])
def create_folder():
    folder_name = request.form.get('folder_name')
    current_path = request.form.get('current_path')
    new_folder_path = os.path.join(SHARED_DIRECTORY, current_path, secure_filename(folder_name))

    if os.path.exists(new_folder_path):
        return "Un dossier avec ce nom existe déjà.", HTTPStatus.BAD_REQUEST

    try:
        os.makedirs(new_folder_path)
        return redirect(url_for('index'))
    except OSError as e:
        return f"Erreur lors de la création du dossier: {e}", HTTPStatus.INTERNAL_SERVER_ERROR

@app.route('/delete/<path:path>', methods=['DELETE'])
def delete(path):
    path = base64.b64decode(path.encode('utf-8')).decode('utf-8')
    file_handler = FileHandler(SHARED_DIRECTORY)
    status_code, message = file_handler.handle_DELETE(path)
    if status_code == HTTPStatus.OK:
        return redirect(url_for('index'))
    else:
        return message, status_code

def get_local_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
    except Exception:
        ip = "127.0.0.1"
    finally:
        s.close()
    return ip


@app.route('/scan', methods=['GET', 'POST'])
def scan():
    if request.method == 'POST':
        # Traiter les données du scan (par exemple, enregistrer le QR Code scanné)
        qr_code_data = request.form.get('qr_code')
        if qr_code_data:
            # Enregistrez le QR Code scanné dans un fichier CSV
            save_qr_code_to_csv(qr_code_data)
            return jsonify({'success': True})  # Renvoie une réponse JSON pour confirmer le succès
    else:
        return render_template('scan.html')

def save_qr_code_to_csv(qr_code_data):
    """Enregistre le QR Code scanné dans un fichier CSV."""
    csv_file_path = os.path.join(app.config['UPLOAD_FOLDER'], 'qr_codes.csv')
    try:
        with open(csv_file_path, 'a', newline='') as csvfile:
            writer = csv.writer(csvfile)
            writer.writerow([qr_code_data])
        logging.info(f"QR Code '{qr_code_data}' enregistré dans {csv_file_path}")
    except Exception as e:
        logging.error(f"Erreur lors de l'enregistrement du QR Code dans le fichier CSV: {e}")

if __name__ == '__main__':
    local_ip = get_local_ip()
    logging.info(f"Adresse IP locale: {local_ip}")
    app.run(host=local_ip, port=8000, debug=True)




<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link rel="stylesheet" href="https://stackpath.bootstrapcdn.com/bootstrap/4.5.2/css/bootstrap.min.css">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/5.15.4/css/all.min.css">
    <title>Explorateur de fichiers</title>
    <style>
        body {
            padding: 20px;
        }
        .icon {
            width: 32px;
            height: 32px;
            display: inline-block;
            margin-right: 10px;
        }
        .file {
            display: flex;
            align-items: center;
            margin-bottom: 10px;
        }
        .checkbox-wrapper {
            display: flex;
            align-items: center;
        }
        .checkbox-wrapper input[type="checkbox"] {
            margin-right: 5px;
        }
        .progress {
            display: none;
            height: 20px;
        }
        .progress-bar {
            width: 0;
        }
        /* Styles pour améliorer la vitesse de rendu */
        #fileList {
            list-style-type: none;
            padding: 0;
        }
        .list-group-item {
            border-bottom: 1px solid #ddd; /* Réduit le nombre d'éléments DOM */
            transition: background-color 0.2s ease; /* Animation pour une meilleure expérience utilisateur */
        }
        .list-group-item:hover {
            background-color: #f5f5f5;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>Explorateur de fichiers</h1>

        <!-- Formulaire pour uploader des fichiers -->
        <form id="uploadFilesForm" action="/upload" method="post" enctype="multipart/form-data">
            <div class="form-group">
                <label for="files">Sélectionnez des fichiers à télécharger :</label>
                <input type="file" class="form-control" id="files" name="files" multiple>
            </div>
            <button type="submit" class="btn btn-primary">Télécharger les fichiers</button>
        </form>

        <!-- Formulaire pour uploader des dossiers -->
        <form id="uploadFoldersForm" action="/upload" method="post" enctype="multipart/form-data">
            <div class="form-group">
                <label for="folders">Sélectionnez des dossiers à télécharger :</label>
                <input type="file" class="form-control" id="folders" name="files" webkitdirectory directory multiple>
            </div>
            <button type="submit" class="btn btn-primary">Télécharger les dossiers</button>
        </form>

        <div class="progress mt-3">
            <div class="progress-bar" role="progressbar" aria-valuenow="0" aria-valuemin="0" aria-valuemax="100"></div>
        </div>
        <form id="createFolderForm" action="/create_folder" method="post" class="mt-3">
            <div class="form-group">
                <label for="folder_name">Créer un nouveau dossier :</label>
                <input type="text" class="form-control" id="folder_name" name="folder_name">
                <input type="hidden" id="current_path" name="current_path" value="">
            </div>
            <button type="submit" class="btn btn-primary">Créer le dossier</button>
        </form>
        <ul id="fileList" class="list-group mt-3"></ul>
    </div>

    <button id="deleteSelectedButton" class="btn btn-danger mt-3" onclick="deleteSelectedFiles()">Supprimer</button>
    <button id="downloadSelectedButton" class="btn btn-success mt-3" onclick="downloadSelectedFiles()">Télécharger</button>

    <!-- Bouton pour le scan -->
    <button id="scanButton" class="btn btn-info mt-3" onclick="window.location.href='/scan'">Scanner QR Code</button>

    <script src="https://code.jquery.com/jquery-3.5.1.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/popper.js@1.16.1/dist/umd/popper.min.js"></script>
    <script src="https://stackpath.bootstrapcdn.com/bootstrap/4.5.2/js/bootstrap.min.js"></script>
    <script>
        const uploadFilesForm = document.getElementById('uploadFilesForm');
        const uploadFoldersForm = document.getElementById('uploadFoldersForm');
        const progressBar = document.querySelector('.progress-bar');
        const fileList = document.getElementById('fileList');
        const createFolderForm = document.getElementById('createFolderForm');
        let currentPath = ''; 

        function fetchFiles(path) {
            $.ajax({
                url: `/files/${path || ''}`,  // Utiliser une chaîne vide si le chemin n'est pas défini
                type: 'GET',
                success: function(data) {
                    renderFileList(data);
                },
                error: function(error) {
                    alert("Erreur lors de la récupération des fichiers : " + error.responseText);
                }
            });
        }

        function renderFileList(files) {
            // Vérifiez que 'files' est un tableau 
            if (Array.isArray(files)) {
                fileList.innerHTML = '';
                files.forEach(file => {
                    const listItem = document.createElement('li');
                    listItem.className = 'list-group-item file';

                    // Case à cocher
                    const checkboxWrapper = document.createElement('div');
                    checkboxWrapper.className = 'checkbox-wrapper';
                    const checkbox = document.createElement('input');
                    checkbox.type = 'checkbox';
                    checkbox.id = `checkbox-${file.path}`;
                    checkbox.value = file.path;
                    checkbox.checked = file.checked; 
                    checkboxWrapper.appendChild(checkbox);

                    // Lien
                    const link = document.createElement('a');
                    link.href = file.is_dir ? '#' : `/download/${file.path}`;
                    link.textContent = file.name;
                    if (file.is_dir) {
                        link.addEventListener('click', (e) => {
                            e.preventDefault();
                            currentPath = file.path;
                            fetchFiles(file.path);
                        });
                    }

                    // Icône
                    const icon = document.createElement('i');
                    icon.className = `fas fa-${file.is_dir ? 'folder-open' : 'file'} icon`;

                    listItem.appendChild(checkboxWrapper);
                    listItem.appendChild(icon);
                    listItem.appendChild(link);
                    fileList.appendChild(listItem);
                });
                document.getElementById('current_path').value = currentPath; 
            } else {
                console.error("Erreur: 'files' n'est pas un tableau.");
            }
        }

        uploadFilesForm.addEventListener('submit', (event) => {
            event.preventDefault(); 
            const fileInput = document.getElementById('files');
            const files = fileInput.files;

            if (files.length === 0) {
                alert("Veuillez sélectionner au moins un fichier.");
                return;
            }

            progressBar.style.width = '0%';
            document.querySelector('.progress').style.display = 'block';

            const formData = new FormData(uploadFilesForm); 
            $.ajax({
                url: uploadFilesForm.action,
                type: 'POST',
                data: formData,
                contentType: false,
                processData: false,
                xhr: function() {
                    let xhr = new window.XMLHttpRequest();
                    xhr.upload.addEventListener('progress', function(event) {
                        if (event.lengthComputable) {
                            const percentComplete = (event.loaded / event.total) * 100;
                            progressBar.style.width = percentComplete + '%';
                            progressBar.setAttribute('aria-valuenow', percentComplete);
                        }
                    });
                    return xhr;
                },
                success: function(response) {
                    fetchFiles(currentPath);
                    document.querySelector('.progress').style.display = 'none';
                },
                error: function(error) {
                    alert("Erreur lors du téléchargement du fichier : " + error.responseText);
                    document.querySelector('.progress').style.display = 'none';
                }
            });
        });

        // Gestionnaire d'événement pour le formulaire d'upload de dossiers
        uploadFoldersForm.addEventListener('submit', (event) => {
            event.preventDefault(); 
            const fileInput = document.getElementById('folders');
            const files = fileInput.files;

            if (files.length === 0) {
                alert("Veuillez sélectionner au moins un dossier.");
                return;
            }

            progressBar.style.width = '0%';
            document.querySelector('.progress').style.display = 'block';

            const formData = new FormData(uploadFoldersForm); 
            $.ajax({
                url: uploadFoldersForm.action,
                type: 'POST',
                data: formData,
                contentType: false,
                processData: false,
                xhr: function() {
                    let xhr = new window.XMLHttpRequest();
                    xhr.upload.addEventListener('progress', function(event) {
                        if (event.lengthComputable) {
                            const percentComplete = (event.loaded / event.total) * 100;
                            progressBar.style.width = percentComplete + '%';
                            progressBar.setAttribute('aria-valuenow', percentComplete);
                        }
                    });
                    return xhr;
                },
                success: function(response) {
                    fetchFiles(currentPath);
                    document.querySelector('.progress').style.display = 'none';
                },
                error: function(error) {
                    alert("Erreur lors du téléchargement du fichier : " + error.responseText);
                    document.querySelector('.progress').style.display = 'none';
                }
            });
        });

        // Fonction pour supprimer les fichiers/dossiers sélectionnés
        function deleteSelectedFiles() {
            const selectedFiles = [];
            const checkboxes = document.querySelectorAll('#fileList input[type="checkbox"]:checked');
            checkboxes.forEach(checkbox => {
                selectedFiles.push(checkbox.value);
            });

            if (selectedFiles.length === 0) {
                alert("Veuillez sélectionner au moins un fichier/dossier.");
                return;
            }

            // Confirmer la suppression
            if (confirm("Êtes-vous sûr de vouloir supprimer les éléments sélectionnés ?")) {
                selectedFiles.forEach(file => {
                    $.ajax({
                        url: `/delete/${file}`,
                        type: 'DELETE',
                        success: function(response) {
                            fetchFiles(currentPath); // Met à jour la liste après la suppression
                        },
                        error: function(error) {
                            alert("Erreur lors de la suppression : " + error.responseText);
                        }
                    });
                });
            }
        }

        // Fonction pour télécharger les fichiers/dossiers sélectionnés
        function downloadSelectedFiles() {
            const selectedFiles = [];
            const checkboxes = document.querySelectorAll('#fileList input[type="checkbox"]:checked');
            checkboxes.forEach(checkbox => {
                selectedFiles.push(checkbox.value);
            });

            if (selectedFiles.length === 0) {
                alert("Veuillez sélectionner au moins un fichier/dossier.");
                return;
            }

            // Télécharger les fichiers/dossiers sélectionnés
            selectedFiles.forEach(file => {
                // Vérifier si c'est un dossier
                if (file.includes('/')) {
                    // Télécharger le dossier
                    window.location.href = `/download_folder/${file}`;
                } else {
                    // Télécharger le fichier
                    window.location.href = `/download/${file}`;
                }
            });
        }

        createFolderForm.addEventListener('submit', (event) => {
            event.preventDefault();
            const folderName = document.getElementById('folder_name').value;

            if (!folderName) {
                alert("Veuillez entrer un nom de dossier.");
                return;
            }

            $.ajax({
                url: createFolderForm.action,
                type: 'POST',
                data: { folder_name: folderName, current_path: currentPath },
                success: function(response) {
                    fetchFiles(currentPath);
                    document.getElementById('folder_name').value = '';
                },
                error: function(error) {
                    alert("Erreur lors de la création du dossier : " + error.responseText);
                }
            });
        });
        // Fonction pour gérer le clic du bouton Scanner
        function scanQRCode() {
            window.location.href = '/scan'; // Redirige vers la route /scan
        }

        // Ajoute un gestionnaire d'événement au bouton Scan
        document.getElementById('scanButton').addEventListener('click', scanQRCode);

        fetchFiles(currentPath);
    </script>
</body>
</html>   veuillez créer et améliorer les codes

## Collaborate with GPT Engineer

This is a [gptengineer.app](https://gptengineer.app)-synced repository 🌟🤖

Changes made via gptengineer.app will be committed to this repo.

If you clone this repo and push changes, you will have them reflected in the GPT Engineer UI.

## Tech stack

This project is built with React and Chakra UI.

- Vite
- React
- Chakra UI

## Setup

```sh
git clone https://github.com/GPT-Engineer-App/file-explorer-app.git
cd file-explorer-app
npm i
```

```sh
npm run dev
```

This will run a dev server with auto reloading and an instant preview.

## Requirements

- Node.js & npm - [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating)
