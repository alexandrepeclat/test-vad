# Structure
```
project/
│
├── py-common/
│   ├── py_common/
│   │   ├── __init__.py
│   │   └── audio.py
│   └── pyproject.toml
│
├── py-vad-silero/
│   ├── vad.py
│   └── .venv/
│
├── py-vad-pyannote/
│   ├── vad.py
│   └── .venv/
│
├── py-tools/
│   ├── spectrogram.py
│   └── .venv/
│
└── data/
```
	
# Usage
Depuis dossier de base

$env:HF_TOKEN="xyz"
.\vad-pyannote\.venv\Scripts\python.exe .\vad-pyannote\pyannote_heatmap.py test.mp3
.\vad-silero\.venv\Scripts\python.exe .\vad-silero\silero_heatmap.py test.mp3
.\ui\.venv\Scripts\python.exe -m streamlit run .\ui\app.py

Pour exporter sans ouvrir la fenetre matplotlib :
.\vad-pyannote\.venv\Scripts\python.exe .\vad-pyannote\pyannote_heatmap.py test.mp3 --no-plot
.\vad-silero\.venv\Scripts\python.exe .\vad-silero\silero_heatmap.py test.mp3 --no-plot


# Run
.venv\Scripts\activate



# Doc
https://zoomcorp.com/manuals/m4-en/

https://github.com/pyannote/pyannote-audio
https://github.com/snakers4/silero-vad

# Alternative
https://github.com/wiseman/py-webrtcvad


TODO 
à voir pour copilot refactoring tags, tasks...
Et j'aimerais un bouton qui lance la copie SD + générer les données manquantes mais attention car c'est une tâche spéciale, elle n'est pas liée à un fichier existant donc pas de filestem + tag... juste un id de tâche en qqsorte. 

On pourrait refactorer en partant du principe que tagKey est plutôt un taskKey et on a des tâches avec juste taskKey sans filekey. elle est quenqueuée en tant que taskKey = copyfromsd et les autres sont des paires taskKey + fileKey. d'un point de vue logique, un tagkey ne doit pas être lié à un tag en particulier ou à un script. tant que la tâche n'est pas exécutée, c'est juste dans la file un taskKey + fileKey (optionel). et à l'exécution, on a une sorte de factory qui doit dire "c'est ce taskKey donc je fabrique un runnable avec tel ou tel script, et telle ou telle manière de l'aborter. la factory devrait être la seule à savoir lier le script au taskKey. pour les tags visuels, côté serveur on devrait avoir un mapping taskType vers tag et inverse. comme ça quand une tâche est créée/démarrée/terminée/annulée, l'ui est notifiée via le taskType et gère elle-même si un tag doit être mis à jour. Elle reçoit par exemple taskType xyz file abc terminée, du coup elle demande au serveur l'état du fichier pour ce tag (available, running, etc...)