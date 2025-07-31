#!/bin/bash

BACKUP_DIR="/tmp/backups"
SOURCE_DIR="$HOME/Documents"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")

create_backup_dir() {
    if [ ! -d "$BACKUP_DIR" ]; then
        mkdir -p "$BACKUP_DIR"
        echo "Created backup directory: $BACKUP_DIR"
    fi
}

backup_files() {
    local backup_file="$BACKUP_DIR/backup_$TIMESTAMP.tar.gz"
    
    echo "Starting backup of $SOURCE_DIR..."
    tar -czf "$backup_file" -C "$SOURCE_DIR" . 2>/dev/null
    
    if [ $? -eq 0 ]; then
        echo "Backup completed successfully: $backup_file"
        ls -lh "$backup_file"
    else
        echo "Backup failed!"
        return 1
    fi
}

cleanup_old_backups() {
    echo "Cleaning up backups older than 7 days..."
    find "$BACKUP_DIR" -name "backup_*.tar.gz" -mtime +7 -delete
}

main() {
    echo "=== Backup Script Started ==="
    create_backup_dir
    backup_files
    cleanup_old_backups
    echo "=== Backup Script Completed ==="
}

main "$@"